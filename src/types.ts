/**
 * Response from the control plane's create endpoint. `host` is the bare label;
 * the client composes the full name as `host.domain` from its resolved domain.
 */
export interface CreateResponse {
  host: string;
  passphrase: string;
}

/** Response from the control plane's rotate endpoint: the new passphrase. */
export interface RotateResponse {
  passphrase: string;
}

/**
 * Response from the control plane's templates endpoint. `default` is the
 * concrete name `default` currently resolves to; `templates` is every available
 * template name, enumerated from the theme volume at request time.
 */
export interface TemplatesResponse {
  default: string;
  templates: string[];
}

/** Error payload shape returned by the control plane on failure. */
export interface ApiError {
  error: string;
}
