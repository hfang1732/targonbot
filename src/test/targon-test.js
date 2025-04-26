/**
 * Simple test script to verify Targon API connectivity
 *
 * To run this test:
 * 1. Set your Targon API key below
 * 2. Run with: node src/test/targon-test.js
 */

// Replace with your actual API key
const apiKey = "sn4_r7l7s99cslvz7oscawdm5zf8jmsh"

// Import required modules
const OpenAI = require("openai")

async function testTargonApi() {
	try {
		console.log("Testing Targon API connection...")
		console.log("API Key format should be: sn4_xxxxxxxxxxxxxxxxxxxxxxxx")

		// Create OpenAI client with Targon API URL
		const client = new OpenAI({
			baseURL: "https://api.targon.com/v1",
			apiKey: apiKey,
			dangerouslyAllowBrowser: true,
			defaultHeaders: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
		})

		// Simple test request with streaming
		console.log("Sending request to Targon API...")

		const stream = await client.chat.completions.create({
			model: "deepseek-ai/DeepSeek-V3",
			messages: [
				{ role: "system", content: "You are a helpful assistant." },
				{ role: "user", content: "Hello, can you help me with a simple test?" },
			],
			temperature: 0.7,
			max_tokens: 100,
			stream: true,
		})

		console.log("API connection successful! Streaming response:")
		console.log("----------------------------------------")

		let fullContent = ""

		// Process the stream
		for await (const chunk of stream) {
			// Extract content from the chunk
			let content = ""
			if (chunk.choices && chunk.choices.length > 0 && chunk.choices[0].delta) {
				content = chunk.choices[0].delta.content || ""
			}

			if (content) {
				fullContent += content
				process.stdout.write(content)
			}
		}

		console.log("\n----------------------------------------")
		console.log("Full response content:")
		console.log(fullContent)

		console.log("----------------------------------------")
		console.log("Test completed successfully!")
	} catch (error) {
		console.error("Error testing Targon API:", error.message)
		console.error("Error details:", error)

		if (error.response) {
			console.error("Response status:", error.response.status)
			console.error("Response data:", error.response.data)
		}

		// Check if it's an authentication error
		if (error.message.includes("401") || error.message.includes("authentication")) {
			console.error("\nAuthentication Error Tips:")
			console.error("1. Make sure your API key is correct and in the format: sn4_xxxxxxxxxxxxxxxxxxxxxxxx")
			console.error("2. Check if your API key has the necessary permissions")
			console.error("3. Verify that the API key is active and not expired")
			console.error("4. Try regenerating a new API key from the Targon dashboard")
		}

		// Check if it's a connection error
		if (error.message.includes("ECONNREFUSED") || error.message.includes("ETIMEDOUT")) {
			console.error("\nConnection Error Tips:")
			console.error("1. Check your internet connection")
			console.error("2. Verify that the Targon API is not down for maintenance")
			console.error("3. Try again later")
		}
	}
}

testTargonApi().catch(console.error)
