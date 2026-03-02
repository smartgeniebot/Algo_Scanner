import os

# 1. First, try to get the URL from GitHub Secrets (the 'Environment Variable')
NEON_URL = os.environ.get('NEON_URL')
    
# 2. If it's not found (meaning you are running locally), use your hardcoded string
if not NEON_URL:
    NEON_URL = "postgresql://neondb_owner:npg_DIqZm0RfxT1u@ep-shiny-hall-a1z6dhn4-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"