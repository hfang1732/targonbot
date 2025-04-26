import { Anthropic } from "@anthropic-ai/sdk"
import { withRetry } from "../retry"
import { ApiHandler } from "../"
import { ApiHandlerOptions, ModelInfo, targonDefaultModelId, targonModels } from "@shared/api"
import { ApiStream } from "../transform/stream"
import { v4 as uuidv4 } from "uuid"
import OpenAI from "openai"
import { ChatCompletionMessageParam } from "openai/resources/chat/completions"
import { TargonFormatRequest, TargonFormatResponse, ApiResponse, ApiMetrics, getApiMetrics } from "../transform/targon-format"

// Define the type for Targon model IDs
type TargonModelId = keyof typeof targonModels

export class TargonHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private client: OpenAI

	constructor(options: ApiHandlerOptions) {
		this.options = options
		this.client = new OpenAI({
			baseURL: "https://api.targon.com/v1",
			apiKey: this.options.targonApiKey || "",
			dangerouslyAllowBrowser: true,
		})
	}

	getModel(): { id: string; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in targonModels) {
			const id = modelId as TargonModelId
			return { id, info: targonModels[id] }
		}
		return {
			id: targonDefaultModelId,
			info: targonModels[targonDefaultModelId],
		}
	}

	@withRetry()
	async *createMessage(systemPrompt: string, messages: Anthropic.Messages.MessageParam[]): ApiStream {
		const model = this.getModel()
		const apiKey = this.options.targonApiKey

		if (!apiKey) {
			throw new Error("Targon API key not found")
		}

		const requestId = uuidv4()
		const startTime = Date.now()
		let responseText = ""
		let tokensIn = 0
		let tokensOut = 0

		try {
			// Convert Anthropic messages to the format expected by Targon
			const formattedMessages = [
				{ role: "system", content: systemPrompt },
				...messages.map((msg) => ({
					role: msg.role,
					content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
				})),
			]

			// Convert to OpenAI-compatible message format
			const openAiMessages: ChatCompletionMessageParam[] = formattedMessages.map((msg) => ({
				role: msg.role as any,
				content: msg.content,
			}))

			// Use OpenAI client with chat completions API
			const stream = await this.client.chat.completions.create({
				model: model.id,
				messages: openAiMessages,
				stream: true,
				temperature: 0.7,
				max_tokens: model.info.maxTokens || 4096,
			})

			for await (const chunk of stream) {
				const content = chunk.choices[0]?.delta?.content || ""
				if (content) {
					responseText += content

					// Stream the text as it comes in
					yield {
						type: "text",
						text: content,
					}
				}

				// Update token counts if available
				if (chunk.usage) {
					tokensIn = chunk.usage.prompt_tokens || 0
					tokensOut = chunk.usage.completion_tokens || 0
				}
			}

			// After streaming is complete, yield usage information
			const metrics: ApiMetrics = getApiMetrics(startTime, tokensIn, tokensOut)

			const response: ApiResponse = {
				id: requestId,
				model: model.id,
				content: responseText,
				created: Math.floor(startTime / 1000),
				metrics: {
					tokensIn: metrics.tokensIn,
					tokensOut: metrics.tokensOut,
					tokensTotal: metrics.tokensTotal,
					timeTotal: metrics.timeTotal,
				},
			}

			yield {
				type: "text",
				text: TargonFormatResponse(response),
			}
		} catch (error: any) {
			throw new Error(`Targon API error: ${error.message}`)
		}
	}
}
