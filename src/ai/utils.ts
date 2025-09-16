import { GenerateResponse } from 'genkit/generate';
import { z } from 'genkit';

// Generic function to run a Genkit prompt with retry logic
export async function runAIPromptWithRetry<
    InputSchema extends z.ZodTypeAny,
    OutputSchema extends z.ZodTypeAny
>(
  prompt: (input: z.infer<InputSchema>) => Promise<GenerateResponse<z.infer<OutputSchema>>>,
  input: z.infer<InputSchema>,
  retries = 1,
  delay = 1000
): Promise<GenerateResponse<z.infer<OutputSchema>>> {
  let lastError: Error | null = null;
  for (let i = 0; i <= retries; i++) {
    try {
      return await prompt(input);
    } catch (e: any) {
      lastError = e;
      const attempt = i + 1;
      const maxAttempts = retries + 1;
      console.log(`AI-PROMPT-RETRY: Attempt ${attempt}/${maxAttempts} failed. Retrying in ${delay}ms...`, e.message);
      
      if (i < retries) {
        // In the retry, we can pass the error to the prompt so the model can self-correct, if the schema supports it
        if ('error' in input) {
            (input as any).error = e.message;
        }
        await new Promise(resolve => setTimeout(resolve, delay * attempt)); // Increase delay for each retry
      }
    }
  }
  console.error("AI-PROMPT-RETRY: All retry attempts failed.", lastError);
  throw lastError;
}
