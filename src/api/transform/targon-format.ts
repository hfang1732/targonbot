import { targonDefaultModelId, targonModels } from "../../shared/api"
import { Anthropic } from "@anthropic-ai/sdk"

// Custom implementation of getApiMetrics for Targon
export function getApiMetrics(startTime: number, tokensIn: number, tokensOut: number): ApiMetrics {
	const endTime = Date.now()
	const timeTotal = endTime - startTime
	return {
		tokensIn,
		tokensOut,
		tokensTotal: tokensIn + tokensOut,
		timeTotal,
	}
}

// Define the types needed for the API request and response
export interface ApiRequest {
	messages: Array<{
		role: string
		content: string
	}>
}

export interface ApiResponse {
	id: string
	model: string
	created: number
	content: string
	metrics?: {
		tokensIn?: number
		tokensOut?: number
		tokensTotal?: number
		timeTotal?: number
	}
}

// This is the return type of getApiMetrics(startTime, tokensIn, tokensOut)
export interface ApiMetrics {
	tokensIn: number
	tokensOut: number
	tokensTotal: number
	timeTotal: number
}

/**
 * Formats an API request for the Targon API
 *
 * @param apiRequest The API request to format
 * @param model The model to use
 * @param options Additional options
 * @returns A formatted request for the Targon API
 */
export function TargonFormatRequest(
	apiRequest: ApiRequest,
	model: string = targonDefaultModelId,
	options: Record<string, any> = {},
) {
	// Convert messages to the format expected by Targon
	const messages = apiRequest.messages.map((message: { role: string; content: string }) => {
		if (message.role === "system") {
			return {
				role: "system",
				content: message.content,
			}
		} else if (message.role === "user" || message.role === "assistant") {
			return {
				role: message.role,
				content: message.content,
			}
		}
		return message
	})

	// Build the request object
	const request = {
		model,
		messages,
		stream: true,
		temperature: options.temperature || 0.7,
		max_tokens: options.max_tokens || targonModels[model as keyof typeof targonModels]?.maxTokens || 4096,
	}

	return request
}

/**
 * Formats an API response from the Targon API
 *
 * @param response The API response to format
 * @returns A formatted response
 */
export function TargonFormatResponse(response: ApiResponse) {
	return JSON.stringify({
		id: response.id,
		model: response.model,
		created: response.created,
		content: response.content,
		tokensIn: response.metrics?.tokensIn,
		tokensOut: response.metrics?.tokensOut,
		tokensTotal: response.metrics?.tokensTotal,
		timeTotal: response.metrics?.timeTotal,
	})
}
