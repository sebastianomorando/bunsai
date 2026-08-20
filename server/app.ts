import { Bundana } from "../lib/Bundana";
import { validateRateLimitConfiguration } from "./rateLimit";

validateRateLimitConfiguration();

const app = new Bundana();

export default app;
