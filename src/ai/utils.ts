/**
 * @fileOverview Utility functions for AI-related tasks, including robust prompt execution with retries.
 */

// Helper function to delay execution.
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Runs a Genkit prompt with a built-in retry mechanism.
 * If the prompt fails, it will retry after a delay.
 * @param prompt The Genkit prompt function to execute.
 * @param input The input to pass to the prompt.
 * @param retries The maximum number of retries.
 * @param initialDelay The initial delay in ms before the first retry.
 * @returns The output of the prompt.
 * @throws An error if the prompt fails after all retries.
 */
export async function runAIPromptWithRetry<I, O>(
    prompt: (input: I) => Promise<{ output: O | undefined }>,
    input: I,
    retries: number = 3,
    initialDelay: number = 2000
): Promise<O> {
    let lastError: any;
    for (let i = 0; i <= retries; i++) {
        try {
            const { output } = await prompt(input);
            if (output === undefined) {
                throw new Error("AI prompt returned undefined output.");
            }
            return output;
        } catch (error) {
            lastError = error;
            console.error(`AI prompt failed on attempt ${i + 1}. Retrying in ${initialDelay}ms...`, error);
            if (i < retries) {
                await delay(initialDelay);
            }
        }
    }
    console.error("AI prompt failed after all retries.");
    throw lastError;
}
