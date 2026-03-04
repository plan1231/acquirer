when building, run 
```
ASTRO_TELEMETRY_DISABLED=1 npm run build
```
to avoid keychain errors on macos.

When importing env vars, always use astro's env var functionality. for example:
```
import { S3_BUCKET, S3_REGION, S3_ACCESS_KEY, S3_SECRET_KEY, S3_ENDPOINT_URL } from "astro:env/server";
```