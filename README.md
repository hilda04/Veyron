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
3. Stage new items locally. Supply the category, price, unit label, description and upload up to five images. Drafts are stored in the browser (via `localStorage`) and immediately appear on the public storefronts alongside catalogue items.
4. Remove staged drafts at any time.

When you are ready to promote a draft to production, sync the generated JSON (shown in the “Draft item JSON” preview) to DynamoDB and upload the images to your permanent storage. Replace the draft’s `images` array with the hosted URLs.

## Image & Data Storage on AWS

For production use the following architecture:

1. **Amazon S3** – create a bucket (for example `veyron-catalogue-images`) to store product photography. Enable CORS so the web app can load objects directly. Organise images under folders such as `furniture/` and `groceries/`.
2. **Amazon DynamoDB** – create a table (e.g. `VeyronCatalogue`) with a partition key `category` (`Furniture`/`Groceries`) and a sort key `id`. Store each item as a record containing the same fields as the JSON files plus any operational metadata (stock levels, flags, etc.).
3. **AWS Lambda + API Gateway (or AWS AppSync)** – expose CRUD endpoints for catalogue data and secure them with IAM or Cognito. The admin portal form can later call these endpoints to persist drafts instead of relying on local storage.
4. **Image workflow** – when uploading through the admin portal, send files to S3 (presigned upload URLs work well). Store the resulting S3 object URLs back on the item in DynamoDB so the storefront displays the hosted assets.

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
4. Press **Place Order** to launch a pre-filled email to `hildamachando4@gmail.com`. The admin team triages and updates the request from the private portal.

## Customisation Checklist

- **Logo:** replace the placeholder images in `public/assets/` with your official branding.
- **Copy:** update hero text, descriptions and support information in the HTML files to match current services.
- **Catalogue:** maintain `public/data/*.json` for quick bulk updates, or wire the admin portal to your AWS API once live.
- **Automation:** replace the mailto workflow in `public/scripts/order.js` with an API request (for example an AWS Lambda function) to send structured order data directly to your operations team.

## Next Steps

- Connect the admin form to DynamoDB/S3 once your backend is ready.
- Add authentication (Amazon Cognito + Amplify UI) to restrict admin access.
- Schedule regular exports of the DynamoDB table to S3 or Glue for analytics.
