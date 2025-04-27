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
		const apiKey = this.options.targonApiKey || ""
		this.client = new OpenAI({
			baseURL: "https://api.targon.com/v1",
			apiKey: apiKey,
			dangerouslyAllowBrowser: true,
			defaultHeaders: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
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

		// Modify the system prompt to encourage concise responses
		const conciseSystemPrompt = this.makePromptConcise(systemPrompt)

		// Convert Anthropic messages to the format expected by Targon
		const formattedMessages = [
			{ role: "system", content: conciseSystemPrompt },
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

		try {
			// Log the request for debugging
			console.log("Targon API request:", {
				model: model.id,
				messages: openAiMessages.map((m) => ({
					role: m.role,
					content:
						typeof m.content === "string"
							? m.content.length > 50
								? m.content.substring(0, 50) + "..."
								: m.content
							: "[non-string content]",
				})),
				stream: true,
				temperature: 0.7,
				max_tokens: model.info.maxTokens || 4096,
			})

			// Use OpenAI client with chat completions API
			// Try with a simpler request first to avoid 503 errors
			const stream = await this.client.chat.completions.create({
				model: model.id,
				messages: openAiMessages,
				stream: true,
				temperature: 0.7,
				max_tokens: model.info.maxTokens || 4096,
				// Only include tools if needed to avoid potential 503 errors
				...(messages.some(
					(m) => m.content && typeof m.content === "string" && m.content.includes("ask_followup_question"),
				)
					? {
							tools: [
								{
									type: "function",
									function: {
										name: "ask_followup_question",
										description:
											"Ask the user a question to gather additional information needed to complete the task",
										parameters: {
											type: "object",
											properties: {
												question: {
													type: "string",
													description: "The question to ask the user",
												},
												options: {
													type: "array",
													description: "Optional array of 2-5 options for the user to choose from",
													items: {
														type: "string",
													},
												},
											},
											required: ["question"],
										},
									},
								},
							],
						}
					: {}),
			})

			for await (const chunk of stream) {
				// Log the chunk structure for debugging
				console.log("Targon API chunk:", JSON.stringify(chunk, null, 2))

				// Handle content chunks - safely access properties
				let content = ""

				// Try to get content from different possible locations in the response
				if (chunk.choices && chunk.choices.length > 0) {
					if (chunk.choices[0].delta && chunk.choices[0].delta.content) {
						content = chunk.choices[0].delta.content
					} else if ((chunk.choices[0] as any).message && (chunk.choices[0] as any).message.content) {
						content = (chunk.choices[0] as any).message.content
					} else if (typeof chunk.choices[0] === "string") {
						content = chunk.choices[0] as string
					}
				} else if ((chunk as any).content) {
					content = (chunk as any).content
				} else if (typeof chunk === "string") {
					content = chunk as string
				}

				if (content) {
					responseText += content

					// Stream the text as it comes in
					yield {
						type: "text",
						text: content,
					}
				}

				// Handle tool calls - convert them to text format since ApiStream doesn't support tool_call type
				const toolCalls = chunk.choices && chunk.choices.length > 0 ? chunk.choices[0]?.delta?.tool_calls : undefined
				if (toolCalls && toolCalls.length > 0) {
					for (const toolCall of toolCalls) {
						if (toolCall.function && toolCall.function.name === "ask_followup_question") {
							try {
								// Parse the function arguments
								const args = toolCall.function.arguments ? JSON.parse(toolCall.function.arguments) : {}

								// Check if question parameter is present
								if (!args.question) {
									continue // Skip this tool call if question is missing
								}

								// Format the tool call as text in XML format that Cline can parse
								const optionsText =
									args.options && args.options.length > 0
										? `\n<options>\n${JSON.stringify(args.options)}\n</options>`
										: ""

								const toolCallText = `<ask_followup_question>\n<question>${args.question}</question>${optionsText}\n</ask_followup_question>`

								yield {
									type: "text",
									text: toolCallText,
								}
							} catch (e) {
								console.error("Error parsing tool call arguments:", e)
							}
						}
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
			// Check if it's a 503 error, which might be temporary
			if (error.status === 503 || (error.message && error.message.includes("503"))) {
				console.log("Received 503 error from Targon API, trying with simplified request...")

				try {
					// Try again with a simpler request (no tools, lower max_tokens)
					const simpleStream = await this.client.chat.completions.create({
						model: model.id,
						messages: openAiMessages,
						stream: true,
						temperature: 0,
						max_tokens: 1024, // Reduced max_tokens
					})

					for await (const chunk of simpleStream) {
						// Handle content chunks - safely access properties
						let content = ""

						// Try to get content from different possible locations in the response
						if (chunk.choices && chunk.choices.length > 0) {
							if (chunk.choices[0].delta && chunk.choices[0].delta.content) {
								content = chunk.choices[0].delta.content
							}
						}

						if (content) {
							responseText += content
							yield {
								type: "text",
								text: content,
							}
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

					return // Exit the function if the retry was successful
				} catch (retryError: any) {
					// If the retry also fails, continue to the error handling below
					console.error("Retry after 503 error also failed:", retryError)
					error = retryError // Use the new error for the error message
				}
			}

			// Provide more detailed error information
			let errorMessage = `Targon API error: ${error.message}`

			// Add status code if available
			if (error.status) {
				errorMessage = `Targon API error: ${error.status} ${error.message}`
			}

			// Add more context for common errors
			if (error.message.includes("401") || error.message.includes("authentication")) {
				errorMessage += " - Please check your API key and ensure it is valid."
			} else if (error.message.includes("403")) {
				errorMessage += " - You may not have permission to access this resource."
			} else if (error.message.includes("404")) {
				errorMessage += " - The requested resource was not found. Check the model ID."
			} else if (error.message.includes("429")) {
				errorMessage += " - Rate limit exceeded. Please try again later."
			} else if (error.message.includes("500") || error.message.includes("502") || error.message.includes("503")) {
				errorMessage +=
					" - Server error. The Targon API may be experiencing issues. Try again with a simpler prompt or fewer tokens."
			}

			console.error("Targon API error details:", error)
			throw new Error(errorMessage)
		}
	}

	/**
	 * Modifies the system prompt to encourage more concise responses
	 * @param systemPrompt The original system prompt
	 * @returns A modified system prompt that encourages concise responses
	 */
	private makePromptConcise(systemPrompt: string): string {
		// If the prompt already contains instructions about being concise, return it as is
		if (
			systemPrompt.toLowerCase().includes("concise") ||
			systemPrompt.toLowerCase().includes("brief") ||
			systemPrompt.toLowerCase().includes("short")
		) {
			return systemPrompt
		}

		console.log("hit make prompt concise")
		// Add instructions to be concise
		return `${systemPrompt}\n\nIMPORTANT: Be extremely concise. Provide only direct answers with no explanations, thinking, or reasoning. No "Let's tackle this" or "First, I need to" statements. Just give the final result or action.`
	}
}
