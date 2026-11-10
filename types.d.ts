type ServiceResult<T> =
  | { success: true; data: T }
  | { success: false; message: string };
