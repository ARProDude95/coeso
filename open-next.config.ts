/**
 * Every route in this app is dynamic (it reads the session cookie and the D1
 * database), so Next's incremental cache is never read. Turning it off keeps
 * the deployed worker simpler and avoids populating a cache that stays empty.
 *
 * The hosting integration regenerates its own config file and merges this one
 * in as the user override.
 */
const config = {
  dangerous: {
    disableIncrementalCache: true,
  },
};

export default config;
