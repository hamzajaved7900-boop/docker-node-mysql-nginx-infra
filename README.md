Enterprise 3-Tier Microservices Deployment on AWS ECS Fargate
Overview and Architecture
This project demonstrates the complete containerization, secret isolation, and production deployment of a three-tier microservices application on AWS ECS Fargate following the Principle of Least Privilege (PoLP) and zero hardcoded credentials.

The architecture consists of three core components:

Web Ingress Layer (Nginx): Listens on public port 80 and reverse proxies requests to the internal backend.

Application Layer (Node.js): Runs on port 5000, executes business logic, and interacts with the database.

Database Layer (MySQL 8.0): Runs on port 3306 and holds relational application tables.

In AWS ECS Fargate, the task utilizes the awsvpc networking mode where all three containers share a common network interface and localhost loopback adapter (127.0.0.1). Consequently, Nginx routes traffic directly to http://127.0.0.1:5000, and Node.js connects to MySQL via host 127.0.0.1:3306.

Directory Structure
.github/workflows/deploy.yml: Continuous integration and deployment pipeline script.

backend/Dockerfile: Node.js container blueprint.

backend/.dockerignore: Excludes unnecessary files like node_modules from container context.

backend/package.json: Application dependencies and run scripts.

backend/server.js: Express API definitions and MySQL query connections.

db/Dockerfile: MySQL container blueprint.

db/init.sql: Automatic database and schema initialization scripts.

nginx/default.conf: Nginx reverse proxy configuration.

nginx/Dockerfile: Nginx custom reverse proxy image blueprint.

.env.example: Reference template for development variables.

.gitignore: Excludes sensitive credentials and artifacts from source control.

docker-compose.yml: Local development container orchestration file.

task-definition.json: ECS Fargate infrastructure and container specification.

Complete Setup, Configuration, and Deployment Steps
Local Testing: Verify local containers by executing docker compose up --build -d. Validate endpoints using curl http://localhost/health for application status and curl http://localhost/api/data for database query connectivity. Tear down local services with docker compose down.

ECR Authentication and Image Pushing: Create three private repositories named mysql-db, node-backend, and nginx-proxy in AWS ECR region us-east-1. Run aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin 887951336993.dkr.ecr.us-east-1.amazonaws.com. Tag and push all images:
docker tag mysql-db:latest [887951336993.dkr.ecr.us-east-1.amazonaws.com/mysql-db:latest](https://887951336993.dkr.ecr.us-east-1.amazonaws.com/mysql-db:latest)
docker push [887951336993.dkr.ecr.us-east-1.amazonaws.com/mysql-db:latest](https://887951336993.dkr.ecr.us-east-1.amazonaws.com/mysql-db:latest)
docker tag node-backend:latest [887951336993.dkr.ecr.us-east-1.amazonaws.com/node-backend:latest](https://887951336993.dkr.ecr.us-east-1.amazonaws.com/node-backend:latest)
docker push [887951336993.dkr.ecr.us-east-1.amazonaws.com/node-backend:latest](https://887951336993.dkr.ecr.us-east-1.amazonaws.com/node-backend:latest)
docker tag nginx-proxy:latest [887951336993.dkr.ecr.us-east-1.amazonaws.com/nginx-proxy:latest](https://887951336993.dkr.ecr.us-east-1.amazonaws.com/nginx-proxy:latest)
docker push [887951336993.dkr.ecr.us-east-1.amazonaws.com/nginx-proxy:latest](https://887951336993.dkr.ecr.us-east-1.amazonaws.com/nginx-proxy:latest)

Secrets Creation in Parameter Store: Open AWS Systems Manager, navigate to Parameter Store, and create two SecureString parameters encrypted with AWS KMS:

Name: Database-password (Stores application database password)

Name: Database-root-password (Stores MySQL root password)

IAM Hardening on ecsTaskExecutionRole: Open IAM Console, access ecsTaskExecutionRole, remove broad managed policies like AmazonSSMReadOnlyAccess, and attach an inline policy granting access only to the explicit parameter ARNs and KMS decryption:

JSON
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
                "arn:aws:ssm:us-east-1:887951336993:parameter/Database-password",
                "arn:aws:ssm:us-east-1:887951336993:parameter/Database-root-password"
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
Task Definition Configuration: Register task definition multi-container-task with Fargate compatibility, CPU 1024, Memory 2048, awsvpc network mode, and executionRoleArn pointing to arn:aws:iam::887951336993:role/ecsTaskExecutionRole. Database credentials must use valueFrom pointing directly to parameter ARNs (arn:aws:ssm:us-east-1:887951336993:parameter/Database-password and arn:aws:ssm:us-east-1:887951336993:parameter/Database-root-password). Setup dependsOn conditions so backend waits on db and Nginx waits on backend.

Service Deployment and Validation: Deploy the task definition revision to ECS Service web-microservice with Public IP enabled and a Security Group permitting HTTP traffic on port 80. Once the task transitions to RUNNING, fetch the public IP and test the live setup:

Run curl -i http://<TASK_PUBLIC_IP>/health (Expects HTTP 200 OK).

Run curl -i http://<TASK_PUBLIC_IP>/api/data (Expects database connection confirmation and valid response {"message":"Connected to Database via Docker Network!","result":2}).
