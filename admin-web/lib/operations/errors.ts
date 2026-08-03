export const PERMISSION_ERROR_MESSAGE = '你沒有權限在目前機構執行此操作，請重新登入；如仍出現，請聯絡系統管理員。';
export const FOREIGN_KEY_ERROR_MESSAGE = '所選資料已不存在或不屬於目前機構，請重新選擇。';
export const DUPLICATE_ERROR_MESSAGE = '已有相同記錄，請勿重複建立。';
export const LEAVE_SESSION_ERROR_MESSAGE = '這名學生沒有報讀所選課堂的班別，或該課堂已取消、已開始或不再接受請假。請重新選擇。';
export const TEACHER_IDENTITY_ERROR_MESSAGE = '此登入身份已連結其他機構或其他職員角色，不能改為導師。';
export const IDEMPOTENCY_ERROR_MESSAGE = '表單內容已在提交後改變。請重新整理頁面，再重新操作。';

type ErrorLike = {
  code?: unknown;
  status?: unknown;
  statusCode?: unknown;
  message?: unknown;
};

export class UserFacingOperationError extends Error {
  readonly userFacing = true;

  constructor(message: string) {
    super(message);
    this.name = 'UserFacingOperationError';
  }
}

export function userFacingError(message: string) {
  return new UserFacingOperationError(message);
}

function asErrorLike(error: unknown): ErrorLike {
  return error && typeof error === 'object' ? (error as ErrorLike) : {};
}

function errorCode(error: unknown) {
  const code = asErrorLike(error).code;
  return typeof code === 'string' ? code : '';
}

function errorStatus(error: unknown) {
  const value = asErrorLike(error).status ?? asErrorLike(error).statusCode;
  return typeof value === 'number' ? value : Number(value) || 0;
}

function errorText(error: unknown) {
  const message = asErrorLike(error).message;
  return typeof message === 'string' ? message.toLowerCase() : '';
}

function logSafeFailure(operation: string, error: unknown, referenceId: string) {
  // Never log the provider message: it may contain SQL, tokens, emails, or row data.
  console.error('[admin-operation-failure]', {
    operation,
    referenceId,
    code: errorCode(error) || undefined,
    status: errorStatus(error) || undefined
  });
}

export function safeErrorMessage(
  error: unknown,
  fallback = '操作未能完成，請稍後再試。',
  operation = 'operation'
) {
  if (error instanceof UserFacingOperationError) return error.message;

  const referenceId = crypto.randomUUID();
  const code = errorCode(error);
  const status = errorStatus(error);
  const message = errorText(error);

  if (/session is not available for this student/.test(message)) {
    logSafeFailure(operation, error, referenceId);
    return LEAVE_SESSION_ERROR_MESSAGE;
  }

  if (/teacher identity belongs to another organization|identity already has a different organization role/.test(message)) {
    logSafeFailure(operation, error, referenceId);
    return TEACHER_IDENTITY_ERROR_MESSAGE;
  }

  if (/idempotency key payload mismatch/.test(message)) {
    logSafeFailure(operation, error, referenceId);
    return IDEMPOTENCY_ERROR_MESSAGE;
  }

  if (code === '42501' || status === 401 || status === 403 || /row-level security|permission denied|not authorized|authorization required|forbidden|unauthorized/.test(message)) {
    logSafeFailure(operation, error, referenceId);
    return PERMISSION_ERROR_MESSAGE;
  }

  if (code === '23505' || /duplicate key|already exists|unique constraint/.test(message)) {
    logSafeFailure(operation, error, referenceId);
    return DUPLICATE_ERROR_MESSAGE;
  }

  if (code === '23503' || code === '23514' || code === 'PGRST116' || /foreign key|cross-organization|cross-tenant|does not exist|not found|reference .* was not found/.test(message)) {
    logSafeFailure(operation, error, referenceId);
    return FOREIGN_KEY_ERROR_MESSAGE;
  }

  logSafeFailure(operation, error, referenceId);
  return `${fallback} 參考編號：${referenceId}`;
}

export function safeOperationMessage(error: unknown, fallback = '操作未能完成，請稍後再試。', operation = 'operation') {
  return safeErrorMessage(error, fallback, operation);
}
