# Veyron Enterprises Web Experience

This repository contains the marketing site and storefront experience for **Veyron Enterprises**. Visitors can browse furniture and grocery catalogues, build a cart, and submit an order that the internal team reviews from a private admin portal. Admin users can now stage new catalogue items (with up to five images each) before pushing them to production storage on AWS.

## Project Structure

```
public/
├── assets/
├── data/
│   ├── furniture.json         # Furniture catalogue feed
│   └── groceries.json         # Grocery catalogue feed
├── scripts/
│   ├── admin.js               # Order board + inventory management UI
│   ├── cart.js                # Cart state and checkout helper
│   ├── common.js              # Shared header/footer utilities
│   ├── data-store.js          # Local product drafts + image gallery helper
│   └── shop.js                # Product rendering, filters, pagination
├── styles/
│   └── styles.css             # Global styles
├── furniture.html             # Furniture storefront (loads furniture.json)
├── groceries.html             # Grocery storefront (loads groceries.json)
├── order.html                 # Checkout confirmation page
└── veyron-admin-portal.html   # Hidden admin dashboard (direct link access)
```

Serve the `public` directory with any static web server for local development:

```bash
npx serve public
```

Open the printed URL (typically http://localhost:3000) to explore the experience.

## Managing Catalogue Data

### JSON data sources

- **Groceries** are loaded from [`public/data/groceries.json`](public/data/groceries.json). Each entry supports `id`, `name`, `price`, `unitLabel`, `description` (optional) and an `images` array (up to five URLs).
- **Furniture** is loaded from [`public/data/furniture.json`](public/data/furniture.json) using the same schema.

Updating either JSON file automatically refreshes the related storefront on the next page load. Maintain a consistent `id` per item so carts and orders remain stable.

### Drafting new items from the admin portal

Visit `veyron-admin-portal.html` (keep the URL private) to:

1. Review captured orders, filter by status, and download open-order details as plain text.
2. Inspect the current furniture and grocery catalogue, including image galleries for each listing.
3. Stage new catalogue items locally **or edit the listings already published**. You can add or remove photography (up to five images per item), change descriptions/pricing and hide products from the storefront without touching the JSON files.
4. Use the **Sync changes to AWS** button once your API Gateway endpoint is configured in `public/scripts/config.js`.

Drafts, overrides and hidden items are stored in the browser (via `localStorage`) so you can experiment safely. When you are ready to publish the changes to AWS, update `scripts/config.js` with your API URL and run the sync action from the admin portal.

## Image & Data Storage on AWS

The repository now includes a ready-to-deploy serverless backend under [`infrastructure/`](infrastructure/). The [`template.yaml`](infrastructure/template.yaml) SAM template provisions:

1. **Amazon API Gateway** – REST endpoints for syncing catalogue updates and generating S3 upload URLs.
2. **AWS Lambda (Node.js 18)** – business logic that stores products in DynamoDB and issues pre-signed S3 URLs.
3. **Amazon DynamoDB** – a pay-per-request table keyed by `Category` and `ProductId` to hold the canonical catalogue.
4. **Amazon S3** – an images bucket with CORS rules so the storefront can serve uploaded photography.

Deploy the stack with `sam build && sam deploy --guided`, then paste the emitted `ApiUrl` into `public/scripts/config.js`. After that, the **Sync changes to AWS** button will push your local drafts, overrides and removals into DynamoDB in one call.

## Deploying with AWS Amplify

1. **Connect the repo** to Amplify Hosting (Console → New App → Host web app → Git repository).
2. **Build settings:** no framework build is required. Use `npm install` (optional) and set the build command to `-` (or leave blank). Set the output directory to `public`.
3. **Environment variables:** add any API endpoints or bucket names you introduce later as Amplify environment variables so they are available to the frontend via a configuration file.
4. **Custom domains:** map your domain in Amplify and enable automatic HTTPS.
5. **Backend integration (optional):** Amplify’s Gen 2 backend or AWS CDK can provision the DynamoDB table, S3 bucket and Lambda/API Gateway stack. Update `scripts/data-store.js` to call your API once it is available.

## Order Flow

1. Browse **Furniture** or **Groceries**, search/filter items, and add quantities (1–10) to the cart.
2. Open the cart drawer to review, adjust quantities or remove items. Totals update instantly.
3. Click **Submit Order** to move to `order.html` where the customer confirms contact information, delivery schedule and payment preference.
4. Press **Place Order** to send the order (including proof of payment) straight to `support@veyronenterprises.com`. The admin team triages and updates the request from the private portal.

## Customisation Checklist

- **Logo:** replace the placeholder images in `public/assets/` with your official branding.
- **Copy:** update hero text, descriptions and support information in the HTML files to match current services.
- **Catalogue:** maintain `public/data/*.json` for quick bulk updates, or wire the admin portal to your AWS API once live.
- **Automation:** replace the mailto workflow in `public/scripts/order.js` with an API request (for example an AWS Lambda function) to send structured order data directly to your operations team.
- **Security:** provision a Cloudflare Turnstile site key (`<meta name="turnstile-site-key">`) and secret so the storefront order form can validate submissions server-side.

## Next Steps

- Connect the admin form to DynamoDB/S3 once your backend is ready.
- Add authentication (Amazon Cognito + Amplify UI) to restrict admin access.
- Schedule regular exports of the DynamoDB table to S3 or Glue for analytics.
