export type ArbrainErrorCode =
  | "HTTP_ERROR"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "UNKNOWN_ERROR";

interface ArbrainApiErrorParams {
  message: string;
  code: ArbrainErrorCode;
  statusCode?: number;
}

export class ArbrainApiError extends Error {
  readonly code: ArbrainErrorCode;
  readonly statusCode?: number;

  constructor(params: ArbrainApiErrorParams) {
    super(params.message);

    this.name = "ArbrainApiError";
    this.code = params.code;
    this.statusCode = params.statusCode;
  }
}