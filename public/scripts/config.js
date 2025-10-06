window.adminApiConfig = window.adminApiConfig || {
  /**
   * Base URL of your deployed API Gateway endpoint, e.g. https://abc123.execute-api.af-south-1.amazonaws.com/prod
   */
  baseUrl: '',
  /**
   * Optional bearer token or API key used to authorise requests to the admin API.
   * Leave blank if your API is public (not recommended).
   */
  authToken: '',
  /**
   * Optional additional headers, expressed as an object literal of key/value pairs.
   * Example: { 'x-api-key': 'YOUR_KEY' }
   */
  extraHeaders: {},
};
