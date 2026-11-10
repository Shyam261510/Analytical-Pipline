export const handleAsync = async <T>(
  operation: () => Promise<T>,
  context: string,
): Promise<ServiceResult<T>> => {
  try {
    const data = await operation();

    return {
      success: true,
      data,
    };
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    console.error(`[Error] ${context}`, errorMessage);

    return {
      success: false,
      message: errorMessage,
    };
  }
};
