export type AdrienErrorCode =
  | 'CONFIG_NOT_FOUND'
  | 'CONFIG_INVALID'
  | 'CONFIG_EXISTS'
  | 'READ_ONLY_LOG'
  | 'ADR_NOT_FOUND'
  | 'ADR_LOCKED'
  | 'ADR_CONFLICT'
  | 'INVALID_INPUT'
  | 'PARSE_ERROR';

/** An expected failure: the CLI prints its message without a stack trace. */
export class AdrienError extends Error {
  readonly code: AdrienErrorCode;

  constructor(code: AdrienErrorCode, message: string) {
    super(message);
    this.name = 'AdrienError';
    this.code = code;
  }
}
