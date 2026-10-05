import { Bundana } from "../lib/Bundana";
import { validateRateLimitConfiguration } from "./rateLimit";
import { validateAssetStorageConfiguration } from "./assetStorage";

validateRateLimitConfiguration();
validateAssetStorageConfiguration();

const app = new Bundana();

export default app;
