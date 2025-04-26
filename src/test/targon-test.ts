const { TargonHandler } = require("../api/providers/targon")
const { ApiHandlerOptions } = require("../shared/api")

/**
 * Simple test script to verify Targon API connectivity
 *
 * To run this test:
 * 1. Set your Targon API key in the options below
 * 2. Run with: npx ts-node src/test/targon-test.ts
 */
async function testTargonApi() {
	// Replace with your actual API key
	const apiKey = "your-targon-api-key"

	const options = {
		targonApiKey: apiKey,
		apiModelId: "deepseek-ai/DeepSeek-V3",
	}

	const targonHandler = new TargonHandler(options)

	try {
		console.log("Testing Targon API connection...")

		const systemPrompt = "You are a helpful assistant."
		const messages = [{ role: "user" as const, content: "Hello, can you help me with a simple test?" }]

		const stream = targonHandler.createMessage(systemPrompt, messages)

		console.log("API connection successful! Streaming response:")
		console.log("----------------------------------------")

		for await (const chunk of stream) {
			if (chunk.type === "text") {
				process.stdout.write(chunk.text)
			}
		}

		console.log("\n----------------------------------------")
		console.log("Test completed successfully!")
	} catch (error) {
		console.error("Error testing Targon API:", error)
	}
}

testTargonApi().catch(console.error)
