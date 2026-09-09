# Payment setup

This build includes a UPI QR code, a UPI payment button, and a Card/UPI gateway button.

For real card/UPI gateway payments, configure these Render Environment Variables:
- RAZORPAY_KEY_ID = Live Key ID
- RAZORPAY_KEY_SECRET = Live Key Secret

Keep the secret key out of GitHub. Use Razorpay Test Mode first; switch to Live keys only after end-to-end testing.
