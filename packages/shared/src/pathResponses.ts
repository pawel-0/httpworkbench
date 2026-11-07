import { z } from "zod";
import { INSTANCE_RAW_LIMIT_BYTES } from "./constants";

export const MAX_PATH_RESPONSES = 50;

export const ResponsePathSchema = z
  .string()
  .max(2048)
  .startsWith(
    "/",
    "Use an absolute path starting with /, without a query string, fragment, or spaces",
  )
  .refine(
    (value) =>
      !/[\s?#]/.test(value) &&
      Array.from(value).every((character) => {
        const code = character.charCodeAt(0);
        return code >= 32 && code !== 127;
      }),
    "Use an absolute path starting with /, without a query string, fragment, or spaces",
  );

export const PathResponseSchema = z
  .object({
    path: ResponsePathSchema,
    raw: z.string().max(INSTANCE_RAW_LIMIT_BYTES),
  })
  .strict();

export const PathResponsesSchema = z
  .array(PathResponseSchema)
  .max(MAX_PATH_RESPONSES)
  .refine(
    (responses) =>
      new Set(responses.map((response) => response.path)).size ===
      responses.length,
    "Each path can have only one response",
  );

export type PathResponse = z.infer<typeof PathResponseSchema>;

export const SetPathResponsesSchema = z
  .object({ pathResponses: PathResponsesSchema })
  .strict();
export type SetPathResponsesInput = z.infer<typeof SetPathResponsesSchema>;
