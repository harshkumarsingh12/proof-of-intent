/** Studio needs a license key and the operator login, since its chat posts through the operator proxy. */
export const studioEnabled = (env: NodeJS.ProcessEnv = process.env): boolean =>
  Boolean(env.AG_STUDIO_LICENSE_KEY?.trim() && env.OPERATOR_PASSWORD && env.OPERATOR_TOKEN);
