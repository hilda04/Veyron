# Veyron Admin Backend

This directory contains an AWS Serverless Application Model (SAM) template and runtime code that provision the
infrastructure required by the enhanced Veyron admin portal. The stack deploys:

- **Amazon API Gateway** exposing REST endpoints that the admin UI can call to sync catalogue changes.
- **AWS Lambda (Node.js 18)** to handle inventory synchronisation, CRUD operations and S3 upload URL generation.
- **Amazon DynamoDB** for storing the canonical catalogue entries.
- **Amazon S3** bucket used to store product photography uploaded from the dashboard.

## Prerequisites

1. Install the [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html).
2. Configure your AWS credentials locally (`aws configure`) with permissions to deploy CloudFormation stacks, DynamoDB,
   Lambda, API Gateway and S3 resources.
3. (Optional) Create a dedicated AWS account or IAM user/role for the project.

## Deploying the stack

```bash
cd infrastructure
sam build
sam deploy \
  --guided \
  --stack-name veyron-admin \
  --capabilities CAPABILITY_IAM
```

During the guided deploy you will be prompted for:

- **Stack Name** – the CloudFormation stack identifier (default is `veyron-admin`).
- **StageName** – the API Gateway stage (default `prod`).
- **AllowedOrigins** – comma separated origins allowed to call the API (for local testing you can use `http://localhost:3000`).
- **SignedUrlExpiry** – validity window in seconds for generated S3 upload URLs (default 900 seconds).

Once deployment completes, the command line output will display the `ApiUrl`, `ProductsTableName` and
`ProductImagesBucketName` outputs. Record the API URL – you will paste it into `public/scripts/config.js`.

## Local testing

You can run the Lambda function locally with the SAM CLI:

```bash
sam local start-api --env-vars env.sample.json
```

Create an `env.sample.json` file that sets `AllowedOrigins`, `TABLE_NAME`, `BUCKET_NAME` and other environment variables
for local use. The file can look like this:

```json
{
  "ProductsFunction": {
    "TABLE_NAME": "veyron-admin-products",
    "BUCKET_NAME": "veyron-admin-product-images",
    "ALLOWED_ORIGINS": "http://localhost:3000",
    "URL_EXPIRY_SECONDS": "900"
  }
}
```

## Post-deploy configuration

1. Open `public/scripts/config.js` and set `baseUrl` to the API Gateway URL returned during deployment. If you configured
   an authorisation mechanism (e.g. Lambda authoriser, IAM, API key) add the corresponding values to `authToken` or
   `extraHeaders`.
2. Update the CORS `AllowedOrigins` parameter and `scripts/config.js` whenever you add new domains (for example when you
   publish the admin UI).
3. Point the storefront data loaders to DynamoDB (either by exporting data to JSON or by adding runtime calls to the API).

## Endpoints overview

| Method & Path                           | Description                                              |
|----------------------------------------|----------------------------------------------------------|
| `POST /sync`                           | Bulk synchronises published, draft and removed items.    |
| `GET /products?category=Furniture`     | Lists items, optionally filtered by category.            |
| `GET /products/{category}/{id}`        | Returns a single product record.                         |
| `PUT /products/{category}/{id}`        | Creates or updates one product.                          |
| `DELETE /products/{category}/{id}`     | Removes a product from the table.                        |
| `POST /products/{category}/{id}/images`| Generates a pre-signed S3 URL for image uploads.         |

All endpoints return CORS headers so they can be called directly from the browser once `AllowedOrigins` is configured.
