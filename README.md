# Veyron Enterprises Web Experience

This repository contains a refreshed static website for **Veyron Enterprises** covering equipment hire, furniture collections and
fresh grocery supply. Furniture and grocery pages now include a modern shopping experience with a cart, order review page and
mailto-based checkout that emails `hildamachando4@gmail.com` with the full order details.

## Project Structure

```
public/
├── assets/
│   ├── hero-pattern.svg
│   └── logo.svg               # Placeholder – replace with your official logo
├── equipment.html             # Equipment hire overview
├── furniture.html             # Furniture catalogue with cart access
├── groceries.html             # Grocery catalogue with cart access
├── order.html                 # Shared order details page
├── scripts/
│   ├── cart.js                # Cart state, drawer UI and checkout routing
│   ├── common.js              # Navigation highlight + footer year helper
│   ├── order.js               # Order page summary + mailto workflow
│   └── shop.js                # Product rendering + add-to-cart actions
└── styles/
    └── styles.css             # Global styling
```

## Local Development

Serve the `public` directory using any static web server:

```bash
npx serve public
```

Then open [http://localhost:3000](http://localhost:3000) (or the printed URL) to explore the experience.

## Order Flow

1. Visit the **Furniture** or **Groceries** page and use the quantity selector (1–10) to add items to the cart.
2. Open the cart drawer to review, adjust quantities or remove items. The cart icon updates with the running item count.
3. Click any **Submit Order** button to proceed to `order.html` where you will confirm contact information, delivery date & time and
   payment method (Cash, Western Union, World Remit or EcoCash).
4. Press **Place Order** to launch a pre-filled email to `hildamachando4@gmail.com` containing your cart summary and delivery
   preferences. Send the email to finalise your request.

## Customisation

- **Upload your logo:** replace `public/assets/logo.svg` with your official artwork (keep the same filename so every page picks it up
  automatically).
- **Update products:** edit the `window.shopConfig` objects inside `furniture.html` and `groceries.html` to adjust items, pricing or
  descriptions.
- **Email automation:** to send orders automatically without opening the user’s email client, replace the mailto logic in
  `public/scripts/order.js` with a request to your preferred API (for example an AWS Lambda function behind API Gateway).

## Deploying on AWS Amplify

1. Connect this repository to Amplify Hosting.
2. Set the build command to `-` (no build required) and the publish directory to `public`.
3. Amplify will upload the static assets and make the site available on your configured domain.
