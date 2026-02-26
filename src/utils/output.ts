export interface AgentOutput<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

export function jsonOutput<T>(success: boolean, data?: T, errorCode?: string, errorMessage?: string) {
  const result: AgentOutput<T> = { success };
  if (data !== undefined) result.data = data;
  if (errorCode || errorMessage) {
    result.error = { code: errorCode || 'UNKNOWN_ERROR', message: errorMessage || 'Unknown error occurred' };
  }
  console.log(JSON.stringify(result));
  process.exit(success ? 0 : 1);
}

export function humanOutput(message: string, isError = false) {
  if (isError) {
    console.error(`\x1b[31m[ERROR]\x1b[0m ${message}`);
    process.exit(1);
  } else {
    console.log(`\x1b[32m[SUCCESS]\x1b[0m ${message}`);
    process.exit(0);
  }
}

export function emitOutput<T>(options: { json: boolean }, success: boolean, data?: T, humanMessage?: string, errorCode?: string, errorMessage?: string) {
  if (options.json) {
    jsonOutput(success, data, errorCode, errorMessage);
  } else {
    humanOutput(humanMessage || errorMessage || 'Operation completed', !success);
  }
}
