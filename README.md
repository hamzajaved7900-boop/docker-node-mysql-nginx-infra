Production-Grade 3-Tier Microservices on AWS ECS Fargate
An end-to-end, production-ready deployment of a 3-tier web application using Docker containers, AWS Elastic Container Registry (ECR), AWS ECS Fargate (awsvpc), AWS Systems Manager (SSM) Parameter Store, and strict IAM security policies.
1. What is This Project? (The Big Picture)
If you are new to Cloud and DevOps, think of this architecture like a secure corporate restaurant:
[ Incoming Request (User / Internet) ]
                  │ (Port 80)
                  ▼
┌────────────────────────────────────────────────────────┐
│ Tier 1: Nginx (Front Reception / Reverse Proxy)        │
│ Intercepts all traffic and forwards requests internally│
└───────────────────────┬────────────────────────────────┘
                        │ (Internal: 127.0.0.1:5000)
                        ▼
┌────────────────────────────────────────────────────────┐
│ Tier 2: Node.js Backend (The Kitchen / Logic)          │
│ Executes code, business rules, and API routes          │
└───────────────────────┬────────────────────────────────┘
                        │ (Internal: 127.0.0.1:3306)
                        ▼
┌────────────────────────────────────────────────────────┐
│ Tier 3: MySQL Database (The Safe / Storage)            │
│ Stores and retrieves persistent data                   │
└────────────────────────────────────────────────────────┘


Why AWS ECS Fargate?
Serverless Compute: We do not manage EC2 servers, OS patching, or virtual machine maintenance.
Shared Network (awsvpc): All 3 containers run inside the same task pod and communicate securely over localhost (127.0.0.1).
Zero Plain-Text Secrets: Passwords never exist in Git, Dockerfiles, or task definition files. They are fetched dynamically at container startup from AWS SSM Parameter Store using AWS KMS encryption.
2. Project Directory Structure
├── .github/
│   └── workflows/
│       └── deploy.yml           # CI/CD pipeline automation
├── backend/
│   ├── Dockerfile               # Node.js container blueprint
│   ├── package.json             # App dependencies (Express, MySQL2)
│   ├── server.js                # API code and routes (/health, /api/data)
│   └── .dockerignore            # Excludes node_modules from Docker build
├── db/
│   ├── Dockerfile               # Custom MySQL container blueprint
│   └── init.sql                 # Auto-initializes schema on startup
├── nginx/
│   ├── default.conf             # Reverse proxy config (Port 80 -> 5000)
│   └── Dockerfile               # Custom Nginx container blueprint
├── .env.example                 # Template for required environment variables
├── .gitignore                   # Excludes sensitive and build files from Git
├── docker-compose.yml           # Local development multi-container orchestration
└── task-definition.json         # AWS ECS task definition specification


3. Prerequisites
Before starting, ensure you have installed:
Docker Desktop
AWS CLI v2 (configured with aws configure)
Node.js v18+
An active AWS Account with administrative access.
4. Step-by-Step Implementation Guide
Phase 1: Local Development & Verification
Clone the repository:
git clone <your-repository-url>
cd <repository-directory>


Verify local setup with Docker Compose:
docker compose up --build -d


Test the running local application:
Health Check: Visit http://localhost/health (should return HTTP 200).
Database Route: Visit http://localhost/api/data (should return database connection confirmation).
Stop local containers:
docker compose down


Phase 2: Create AWS ECR Repositories
AWS Elastic Container Registry (ECR) stores private container images.
Create 3 private repositories in your target region (e.g., us-east-1):
aws ecr create-repository --repository-name mysql-db --region us-east-1
aws ecr create-repository --repository-name node-backend --region us-east-1
aws ecr create-repository --repository-name nginx-proxy --region us-east-1


Authenticate Docker with your ECR registry:
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <YOUR_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com


Phase 3: Build, Tag, and Push Container Images
Build production images targeting linux/amd64 architecture (required by Fargate):
MySQL Database:
docker build --platform linux/amd64 -t mysql-db ./db
docker tag mysql-db:latest <YOUR_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/mysql-db:latest
docker push <YOUR_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/mysql-db:latest


Node.js Backend:
docker build --platform linux/amd64 -t node-backend ./backend
docker tag node-backend:latest <YOUR_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/node-backend:latest
docker push <YOUR_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/node-backend:latest


Nginx Reverse Proxy:
docker build --platform linux/amd64 -t nginx-proxy ./nginx
docker tag nginx-proxy:latest <YOUR_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/nginx-proxy:latest
docker push <YOUR_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/nginx-proxy:latest


Phase 4: Configure Encrypted Secrets (AWS SSM Parameter Store)
Passwords must never be committed to code or JSON task definitions.
Open AWS Systems Manager > Parameter Store.
Create the application user password:
Name: Database-password
Type: SecureString
KMS Key Source: Default (alias/aws/ssm)
Value: <YOUR_STRONG_PASSWORD>
Create the MySQL root password:
Name: Database-root-password
Type: SecureString
KMS Key Source: Default (alias/aws/ssm)
Value: <YOUR_STRONG_ROOT_PASSWORD>
Phase 5: Hardening IAM Security (Principle of Least Privilege)
The ECS execution role (ecsTaskExecutionRole) needs explicit permission to fetch and decrypt only the two specific parameters created in Phase 4.
Go to AWS IAM Console > Roles > ecsTaskExecutionRole.
Remove any broad policies like AmazonSSMReadOnlyAccess.
Click Add permissions > Create inline policy.
Switch to the JSON editor and paste:
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "ssm:GetParameters",
                "ssm:GetParameter"
            ],
            "Resource": [
                "arn:aws:ssm:us-east-1:<YOUR_ACCOUNT_ID>:parameter/Database-password",
                "arn:aws:ssm:us-east-1:<YOUR_ACCOUNT_ID>:parameter/Database-root-password"
            ]
        },
        {
            "Effect": "Allow",
            "Action": [
                "kms:Decrypt"
            ],
            "Resource": "*"
        }
    ]
}


Name the policy ECS-Specific-SSM-Parameters-Policy and save it.
Phase 6: Register ECS Task Definition
In the AWS ECS Console, navigate to Task Definitions > Create new Task Definition with JSON.
Use the configuration below (replace <YOUR_ACCOUNT_ID> with your real 12-digit AWS account ID):
{
  "family": "multi-container-task",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "executionRoleArn": "arn:aws:iam::<YOUR_ACCOUNT_ID>:role/ecsTaskExecutionRole",
  "containerDefinitions": [
    {
      "name": "db",
      "image": "<YOUR_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/mysql-db:latest",
      "essential": true,
      "environment": [
        { "name": "MYSQL_DATABASE", "value": "app_db" },
        { "name": "MYSQL_USER", "value": "app_user" }
      ],
      "secrets": [
        {
          "name": "MYSQL_PASSWORD",
          "valueFrom": "arn:aws:ssm:us-east-1:<YOUR_ACCOUNT_ID>:parameter/Database-password"
        },
        {
          "name": "MYSQL_ROOT_PASSWORD",
          "valueFrom": "arn:aws:ssm:us-east-1:<YOUR_ACCOUNT_ID>:parameter/Database-root-password"
        }
      ],
      "portMappings": [{ "containerPort": 3306, "hostPort": 3306, "protocol": "tcp" }],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-create-group": "true",
          "awslogs-group": "/ecs/multi-container-task",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "db"
        }
      }
    },
    {
      "name": "backend",
      "image": "<YOUR_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/node-backend:latest",
      "essential": true,
      "dependsOn": [{ "containerName": "db", "condition": "START" }],
      "environment": [
        { "name": "PORT", "value": "5000" },
        { "name": "DB_HOST", "value": "127.0.0.1" },
        { "name": "DB_USER", "value": "app_user" },
        { "name": "DB_NAME", "value": "app_db" }
      ],
      "secrets": [
        {
          "name": "DB_PASSWORD",
          "valueFrom": "arn:aws:ssm:us-east-1:<YOUR_ACCOUNT_ID>:parameter/Database-password"
        }
      ],
      "portMappings": [{ "containerPort": 5000, "hostPort": 5000, "protocol": "tcp" }],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-create-group": "true",
          "awslogs-group": "/ecs/multi-container-task",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "backend"
        }
      }
    },
    {
      "name": "nginx",
      "image": "<YOUR_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/nginx-proxy:latest",
      "essential": true,
      "dependsOn": [{ "containerName": "backend", "condition": "START" }],
      "portMappings": [{ "containerPort": 80, "hostPort": 80, "protocol": "tcp" }],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-create-group": "true",
          "awslogs-group": "/ecs/multi-container-task",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "nginx"
        }
      }
    }
  ]
}


Click Create to register the new revision.
Phase 7: Deploy & Verify Service
Create or update your ECS Service (e.g., web-microservice) to use the latest registered Task Definition revision.
Ensure the associated Security Group has:
Inbound Rule: HTTP (Port 80) from 0.0.0.0/0 (Anywhere).
Outbound Rule: All traffic to 0.0.0.0/0 (Required to download images from ECR and call SSM/CloudWatch endpoints).
Once the service deployment reaches RUNNING status:
Open the running task details in the ECS Console.
Copy the assigned Public IP.
Verification Commands:
# 1. Verify Nginx routing and Node.js health
curl http://<TASK_PUBLIC_IP>/health

# Expected response:
# {"status":"healthy","uptime":...}

# 2. Verify database connection and SSM secret injection
curl http://<TASK_PUBLIC_IP>/api/data

# Expected response:
# {"message":"Connected to Database via Docker Network!","result":2}


5. Security & Production Checklist
[x] No hardcoded secrets: Passwords are fully managed in AWS SSM Parameter Store.
[x] Principle of Least Privilege (PoLP): IAM execution role allows parameter access exclusively to specified ARNs.
[x] KMS Decryption: Secure strings are decrypted in memory during container boot and never logged.
[x] Isolated Internal Traffic: Database and backend ports (3306, 5000) are closed to the public internet; ingress is exclusively restricted to Nginx on Port 80.
[x] Centralized Logging: All three containers pipe output streams into AWS CloudWatch under /ecs/multi-container-task.
