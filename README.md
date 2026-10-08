# Enterprise 3-Tier Microservices Deployment on AWS ECS Fargate

A three-tier microservices application (**Nginx → Node.js → MySQL**) containerized with Docker and deployed to **AWS ECS Fargate**, with secrets kept out of the code (AWS Systems Manager Parameter Store + KMS) and a locked-down IAM role following the **Principle of Least Privilege (PoLP)**.

**Highlights**

- Three containers in one ECS Fargate task, started in the right order with `dependsOn`
- Zero hardcoded credentials: passwords are injected at runtime from Parameter Store
- Least-privilege IAM policy scoped to the exact parameters the task needs
- Images stored in private AWS ECR repositories
- Local development with Docker Compose, deployment automation with GitHub Actions

---

## Table of Contents

1. [Architecture](#1-architecture)
2. [Tech Stack](#2-tech-stack)
3. [Project Structure](#3-project-structure)
4. [Prerequisites](#4-prerequisites)
5. [Step 1: Run Locally with Docker Compose](#5-step-1-run-locally-with-docker-compose)
6. [Step 2: Create ECR Repositories and Push Images](#6-step-2-create-ecr-repositories-and-push-images)
7. [Step 3: Store Secrets in Parameter Store](#7-step-3-store-secrets-in-parameter-store)
8. [Step 4: Harden the IAM Execution Role](#8-step-4-harden-the-iam-execution-role)
9. [Step 5: Register the ECS Task Definition](#9-step-5-register-the-ecs-task-definition)
10. [Step 6: Deploy the ECS Service](#10-step-6-deploy-the-ecs-service)
11. [Step 7: Validate the Live Deployment](#11-step-7-validate-the-live-deployment)
12. [CI/CD](#12-cicd)
13. [Security Practices](#13-security-practices)
14. [Troubleshooting](#14-troubleshooting)
15. [Cleanup](#15-cleanup)
16. [Future Improvements](#16-future-improvements)
17. [Author](#17-author)

---

## 1. Architecture

```
                         AWS ECS Fargate Task  (awsvpc, shared 127.0.0.1)
                 ┌──────────────────────────────────────────────────────┐
  Internet       │                                                      │
  (port 80)      │   ┌──────────┐    ┌───────────────┐    ┌──────────┐  │
 ──────────────▶ │   │  Nginx   │───▶│  Node.js API  │───▶│  MySQL   │  │
                 │   │  :80     │    │  :5000        │    │  :3306   │  │
                 │   └──────────┘    └───────────────┘    └──────────┘  │
                 │                                                      │
                 └───────────────▲──────────────────────────────────────┘
                                 │ secrets injected at start-up
                    SSM Parameter Store (SecureString, KMS-encrypted)
```

| Tier | Component | Port | Responsibility |
|------|-----------|------|----------------|
| Web ingress | **Nginx** | 80 (public) | Receives public traffic and reverse-proxies it to the backend |
| Application | **Node.js** (Express) | 5000 (internal) | Business logic and database queries |
| Database | **MySQL 8.0** | 3306 (internal) | Stores relational application data |

### Why the containers talk over `127.0.0.1`

In ECS Fargate, the task uses the **`awsvpc`** network mode. All containers in the same task share **one network interface and one localhost loopback adapter**. Because of this:

- Nginx forwards requests to `http://127.0.0.1:5000`
- Node.js connects to MySQL at `127.0.0.1:3306`

Only port **80** is exposed to the internet. Ports 5000 and 3306 are never opened in the security group, so the backend and the database cannot be reached from outside.

> **Note:** With Docker Compose, containers normally reach each other by *service name* (for example `db`), not `127.0.0.1`. Make sure the Nginx upstream and the database host in the backend are configured so that both environments work (for example through an environment variable such as `DB_HOST`). <!-- TODO: confirm how this project handles it -->

---

## 2. Tech Stack

| Area | Technology |
|------|-----------|
| Reverse proxy | Nginx |
| Backend | Node.js, Express |
| Database | MySQL 8.0 |
| Containers | Docker, Docker Compose |
| Registry | Amazon ECR |
| Compute | Amazon ECS on Fargate |
| Secrets | AWS Systems Manager Parameter Store, AWS KMS |
| Access control | AWS IAM |
| CI/CD | GitHub Actions |

---

## 3. Project Structure

```
.
├── .github/workflows/deploy.yml   # CI/CD pipeline script
├── backend/
│   ├── Dockerfile                 # Node.js container blueprint
│   ├── .dockerignore              # Keeps node_modules etc. out of the build context
│   ├── package.json               # Dependencies and run scripts
│   └── server.js                  # Express API routes and MySQL connection
├── db/
│   ├── Dockerfile                 # MySQL container blueprint
│   └── init.sql                   # Creates the database and tables on first start
├── nginx/
│   ├── Dockerfile                 # Custom Nginx image
│   └── default.conf               # Reverse proxy configuration
├── .env.example                   # Template for local development variables
├── .gitignore                     # Keeps secrets and build artifacts out of Git
├── docker-compose.yml             # Local multi-container orchestration
├── task-definition.json           # ECS Fargate task and container specification
└── README.md
```

---

## 4. Prerequisites

| Requirement | Check with |
|-------------|-----------|
| Git | `git --version` |
| Docker and Docker Compose v2 | `docker --version` and `docker compose version` |
| AWS CLI v2, configured (`aws configure`) | `aws --version` |
| An AWS account with permission to use ECR, ECS, IAM, SSM and KMS | |
| Region used in this guide: `us-east-1` | |

Replace `<AWS_ACCOUNT_ID>` in every command below with your own 12-digit AWS account ID.

---

## 5. Step 1: Run Locally with Docker Compose

**Why:** Always confirm that the three containers work together on your machine before spending time on AWS.

```bash
git clone https://github.com/hamzajaved7900-boop/docker-node-mysql-nginx-infra.git
cd docker-node-mysql-nginx-infra

cp .env.example .env        # then edit .env with your own values

docker compose up --build -d
```

Validate the endpoints:

```bash
curl http://localhost/health      # application status
curl http://localhost/api/data    # proves the backend can query MySQL
```

Stop everything when you are done:

```bash
docker compose down
```

---

## 6. Step 2: Create ECR Repositories and Push Images

**Why:** Fargate cannot use images from your laptop. Images must be stored in a registry that AWS can reach. ECR is a private registry, so only authorized AWS identities can pull the images.

**2.1 Create three private repositories** in region `us-east-1`:

| Repository | Holds |
|------------|-------|
| `mysql-db` | MySQL image |
| `node-backend` | Node.js image |
| `nginx-proxy` | Nginx image |

```bash
aws ecr create-repository --repository-name mysql-db --region us-east-1
aws ecr create-repository --repository-name node-backend --region us-east-1
aws ecr create-repository --repository-name nginx-proxy --region us-east-1
```

**2.2 Build the images** (skip if `docker compose up --build` already created them with these names):

```bash
docker build -t mysql-db:latest ./db
docker build -t node-backend:latest ./backend
docker build -t nginx-proxy:latest ./nginx
```

**2.3 Authenticate Docker to ECR:**

```bash
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com
```

**2.4 Tag and push all three images:**

```bash
docker tag mysql-db:latest <AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/mysql-db:latest
docker push <AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/mysql-db:latest

docker tag node-backend:latest <AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/node-backend:latest
docker push <AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/node-backend:latest

docker tag nginx-proxy:latest <AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/nginx-proxy:latest
docker push <AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/nginx-proxy:latest
```

---

## 7. Step 3: Store Secrets in Parameter Store

**Why:** Passwords must never be written in `task-definition.json`, the Dockerfiles or Git. Parameter Store keeps them encrypted, and ECS injects them into the containers only at start-up.

Open **AWS Systems Manager → Parameter Store** and create two parameters:

| Name | Type | Stores |
|------|------|--------|
| `Database-password` | `SecureString` (KMS-encrypted) | Application database password |
| `Database-root-password` | `SecureString` (KMS-encrypted) | MySQL root password |

CLI alternative:

```bash
aws ssm put-parameter --name "Database-password" \
  --type SecureString --value "<your_app_db_password>" --region us-east-1

aws ssm put-parameter --name "Database-root-password" \
  --type SecureString --value "<your_mysql_root_password>" --region us-east-1
```

`SecureString` means the value is encrypted with AWS KMS and can only be read by identities that have permission to both read the parameter **and** decrypt it.

---

## 8. Step 4: Harden the IAM Execution Role

**Why:** The **task execution role** (`ecsTaskExecutionRole`) is the identity ECS uses to pull images and fetch secrets *on behalf of your task*. Giving it broad access (such as read access to every parameter in the account) breaks least privilege. If one task were ever compromised, only the two secrets it truly needs should be reachable.

1. Open **IAM → Roles → `ecsTaskExecutionRole`**.
2. **Remove** broad managed policies such as `AmazonSSMReadOnlyAccess`.
3. **Keep** `AmazonECSTaskExecutionRolePolicy`. ECS needs it to pull images from ECR and write logs to CloudWatch.
4. **Add an inline policy** that allows only the two parameters and KMS decryption:

```json
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
        "arn:aws:ssm:us-east-1:<AWS_ACCOUNT_ID>:parameter/Database-password",
        "arn:aws:ssm:us-east-1:<AWS_ACCOUNT_ID>:parameter/Database-root-password"
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
```

> **Tip:** `"Resource": "*"` for `kms:Decrypt` works, but it is broader than necessary. For a stricter setup, replace it with the ARN of the specific KMS key that encrypts the parameters.

---

## 9. Step 5: Register the ECS Task Definition

**Why:** The task definition is the blueprint that tells ECS which containers to run, how much CPU/memory to give them, which secrets to inject and in which order to start them.

Register `task-definition.json` with these settings:

| Setting | Value |
|---------|-------|
| Family | `multi-container-task` |
| Launch type compatibility | Fargate |
| CPU / Memory | 1024 (1 vCPU) / 2048 MB |
| Network mode | `awsvpc` |
| Execution role | `arn:aws:iam::<AWS_ACCOUNT_ID>:role/ecsTaskExecutionRole` |

```bash
aws ecs register-task-definition \
  --cli-input-json file://task-definition.json \
  --region us-east-1
```

**Two important parts of the file**

1. **Secrets via `valueFrom`**: the password is never stored in the file. Only the parameter ARN is:

   ```json
   "secrets": [
     {
       "name": "<ENV_VAR_NAME>",
       "valueFrom": "arn:aws:ssm:us-east-1:<AWS_ACCOUNT_ID>:parameter/Database-password"
     },
     {
       "name": "<ENV_VAR_NAME>",
       "valueFrom": "arn:aws:ssm:us-east-1:<AWS_ACCOUNT_ID>:parameter/Database-root-password"
     }
   ]
   ```

   <!-- TODO: replace <ENV_VAR_NAME> with the real variable names from task-definition.json -->

2. **Start order with `dependsOn`**:

   | Container | Waits for |
   |-----------|-----------|
   | `backend` | `db` |
   | `nginx` | `backend` |

   This makes sure the database is up before the API starts, and the API is up before Nginx begins proxying to it.

---

## 10. Step 6: Deploy the ECS Service

**Why:** A service keeps the task running and replaces it if it stops.

Deploy the task definition revision as the service **`web-microservice`** in your ECS cluster:

| Setting | Value |
|---------|-------|
| Launch type | Fargate |
| Task definition | `multi-container-task` (latest revision) |
| Service name | `web-microservice` |
| Desired tasks | 1 |
| Public IP | **Enabled** (so the task can pull images from ECR and be reached from the internet) |
| Security group | Inbound **TCP 80** from `0.0.0.0/0` (HTTP). Do **not** open 5000 or 3306. |

<!-- TODO: add your cluster name, VPC and subnets -->

Wait until the task status changes to **RUNNING** (ECS console → Cluster → Services → `web-microservice` → Tasks).

---

## 11. Step 7: Validate the Live Deployment

1. Open the running task and copy its **Public IP**.
2. Test the endpoints:

```bash
curl -i http://<TASK_PUBLIC_IP>/health
```

Expected: `HTTP/1.1 200 OK`

```bash
curl -i http://<TASK_PUBLIC_IP>/api/data
```

Expected: the database connection is confirmed and the response is:

```json
{"message":"Connected to Database via Docker Network!","result":2}
```

If both calls succeed, all three tiers are working and the secrets were injected correctly.

---

## 12. CI/CD

The pipeline is defined in `.github/workflows/deploy.yml`.

| Item | Details |
|------|---------|
| Trigger | TODO (for example: push to `main`) |
| What it does | TODO (for example: build images, push to ECR, register the task definition, update the service) |
| Required GitHub secrets | TODO (for example: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`) |

Add the secrets in **GitHub → Repository → Settings → Secrets and variables → Actions**. Never put AWS keys in the workflow file.

---

## 13. Security Practices

- **No hardcoded credentials.** Passwords live only in Parameter Store (`SecureString`, KMS-encrypted).
- **Least-privilege IAM.** The execution role can read only the two required parameters.
- **Minimal exposure.** Only port 80 is public. The backend (5000) and the database (3306) are reachable only inside the task.
- **Private image registry.** Images are stored in private ECR repositories.
- **Clean repository.** `.gitignore` excludes `.env` and other sensitive files, and `.dockerignore` keeps `node_modules` out of the image.
- **Keep account-specific values out of public docs** by using placeholders such as `<AWS_ACCOUNT_ID>`.

---

## 14. Troubleshooting

| Problem | Likely cause | Fix |
|---------|--------------|-----|
| Task stops right after starting | An essential container crashed | Open the task → Logs tab (CloudWatch) and check which container exited |
| `ResourceInitializationError: unable to pull secrets` | Wrong parameter ARN or region, or missing KMS/SSM permission | Check the ARNs in `task-definition.json` and the inline IAM policy |
| `CannotPullContainerError` | Image missing in ECR, wrong image URI, or no internet route | Verify the image URI and that Public IP is **enabled** |
| `502 Bad Gateway` from Nginx | Backend not running, or Nginx upstream points to the wrong host/port | In Fargate the upstream must be `127.0.0.1:5000`. Check `nginx/default.conf` |
| Backend cannot connect to MySQL | Wrong DB host or password, or the database is still starting | Use `127.0.0.1:3306` on Fargate, check `dependsOn` and the container logs |
| `curl` to the public IP times out | Security group blocks port 80, or Public IP is disabled | Allow inbound TCP 80 and enable Public IP |
| `init.sql` did not run locally | The MySQL data volume already exists | `docker compose down -v` and start again (this deletes local data) |

---

## 15. Cleanup

Fargate tasks cost money while they run. When you finish testing:

```bash
# Stop the tasks
aws ecs update-service --cluster <CLUSTER_NAME> --service web-microservice --desired-count 0 --region us-east-1

# Delete the service
aws ecs delete-service --cluster <CLUSTER_NAME> --service web-microservice --force --region us-east-1
```

Optionally delete the ECR repositories and the two Parameter Store entries if you no longer need them.

---

## 16. Future Improvements

- Put the application behind an **Application Load Balancer** with HTTPS (ACM certificate)
- Move MySQL to **Amazon RDS** for backups, high availability and persistent storage (data in a Fargate container is lost when the task stops)
- Provision the whole infrastructure with **Terraform**
- Add **CloudWatch** alarms and dashboards
- Add automated tests and image scanning to the CI pipeline
- Restrict `kms:Decrypt` to the specific KMS key ARN

---

## 17. Author

**Hamza Javed**: Cloud & DevOps Engineer
GitHub: [@hamzajaved7900-boop](https://github.com/hamzajaved7900-boop)
