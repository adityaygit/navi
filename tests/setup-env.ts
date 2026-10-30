import { config } from "dotenv";
import { assertLocalSupabase } from "./local-guard";

config({ path: ".env.local", quiet: true });
process.env.NAVI_AI_PROVIDER = "devsim";
assertLocalSupabase();
