import os
import sys
import pyotp
import requests
import base64
from urllib.parse import urlparse, parse_qs
from fyers_apiv3 import fyersModel

    
# 🛡️ THE HYBRID CREDENTIAL ENGINE
# It checks GitHub Secrets first; if not found, it uses your local values.
FYERS_ID = os.environ.get('FYERS_ID', "DM00713")
TOTP_KEY = os.environ.get('TOTP_KEY', "7THHDLSTUPJG6BN32PJ5ZS435XPND2X2")
PIN = os.environ.get('PIN', "0706")
CLIENT_ID = os.environ.get('CLIENT_ID', "QTKF8KZDM9-100")
SECRET_KEY = os.environ.get('SECRET_KEY', "TTFIR7F078")
REDIRECT_URI = "https://127.0.0.1"

# Fyers now strictly requires the ID and PIN to be Base64 encoded
def b64(s):
    return base64.b64encode(str(s).encode()).decode()

def auto_login():
    print("🤖 Starting Fyers Auto-Login Sequence...")
    
    # --- STEP 1: Generate Current TOTP ---
    try:
        current_totp = pyotp.TOTP(TOTP_KEY).now()
    except Exception as e:
        print(f"❌ Invalid TOTP Key. Make sure it is the 32-character text secret: {e}")
        sys.exit(1)

    session = requests.Session()

    # --- STEP 2: Initiate Login ---
    payload_1 = {"fy_id": b64(FYERS_ID), "app_id": "2"}
    res_1 = session.post("https://api-t2.fyers.in/vagator/v2/send_login_otp_v2", json=payload_1).json()

    if res_1.get("s") != "ok":
        print(f"❌ Failed to initiate login: {res_1}")
        sys.exit(1)
    request_key_1 = res_1["request_key"]

    # --- STEP 3: Verify TOTP ---
    payload_2 = {"request_key": request_key_1, "otp": current_totp}
    res_2 = session.post("https://api-t2.fyers.in/vagator/v2/verify_otp", json=payload_2).json()

    if res_2.get("s") != "ok":
        print(f"❌ Failed to verify TOTP: {res_2}")
        sys.exit(1)
    request_key_2 = res_2["request_key"]

    # --- STEP 4: Verify PIN ---
    payload_3 = {"request_key": request_key_2, "identity_type": "pin", "identifier": b64(PIN)}
    res_3 = session.post("https://api-t2.fyers.in/vagator/v2/verify_pin_v2", json=payload_3).json()

    if res_3.get("s") != "ok":
        print(f"❌ Failed to verify PIN: {res_3}")
        sys.exit(1)

    sso_token = res_3["data"]["access_token"]

    # --- STEP 5: Generate Fyers API Auth Code ---
    auth_payload = {
        "fyers_id": FYERS_ID,
        "app_id": CLIENT_ID[:-4],
        "redirect_uri": REDIRECT_URI,
        "appType": "100",
        "code_challenge": "",
        "state": "sample_state",
        "scope": "",
        "nonce": "",
        "response_type": "code",
        "create_cookie": True
    }
    headers = {"Authorization": f"Bearer {sso_token}"}
    res_4 = session.post("https://api-t1.fyers.in/api/v3/token", json=auth_payload, headers=headers).json()

    if res_4.get("s") != "ok":
        print(f"❌ Failed to get auth code URL: {res_4}")
        sys.exit(1)

    url = res_4["Url"]
    parsed_url = urlparse(url)
    auth_code = parse_qs(parsed_url.query)["auth_code"][0]

    # --- STEP 6: Exchange Auth Code for Final Access Token ---
    session_model = fyersModel.SessionModel(
        client_id=CLIENT_ID,
        secret_key=SECRET_KEY,
        redirect_uri=REDIRECT_URI,
        response_type="code",
        grant_type="authorization_code"
    )
    session_model.set_token(auth_code)
    response = session_model.generate_token()

    if "access_token" in response:
        access_token = response["access_token"]
        with open("access_token.txt", "w") as f:
            f.write(access_token)
        print("✅ Auto-Login Complete! Your Fyers token is securely saved to access_token.txt")
    else:
        print(f"❌ Failed to generate final access token: {response}")
        sys.exit(1)

if __name__ == "__main__":
    auto_login()