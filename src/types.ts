/**
 * Response from the control plane's create endpoint. `host` is the bare label;
 * the client composes the full name as `host.domain` from its resolved domain.
 */
export interface CreateResponse {
  host: string;
  passphrase: string;
}

/** Error payload shape returned by the control plane on failure. */
export interface ApiError {
  error: string;
}
