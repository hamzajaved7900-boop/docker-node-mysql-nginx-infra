pipeline {
    agent any

    environment {
        AWS_REGION     = 'us-east-1'
        AWS_ACCOUNT_ID = '887951336993'
        ECR_REPO_NAME  = 'node-app-repo'
        ECS_CLUSTER    = 'production-microservices-cluster'
        ECS_SERVICE    = 'web-microservice'
        IMAGE_TAG      = "${BUILD_NUMBER}"
    }

    stages {
        stage('Checkout') {
            steps {
                echo 'Checking out code from repository...'
                checkout scm
            }
        }

        stage('Build Docker Image') {
            steps {
                echo "Building Docker image for Backend..."
                // Agar Dockerfile backend directory mein hai:
                sh "docker build -t ${ECR_REPO_NAME}:${IMAGE_TAG} ./backend"
            }
        }

        stage('Login to Amazon ECR') {
            steps {
                echo 'Logging into Amazon ECR...'
                sh """
                aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com
                """
            }
        }

        stage('Push Image to ECR') {
            steps {
                echo 'Tagging and pushing image to ECR...'
                sh """
                docker tag ${ECR_REPO_NAME}:${IMAGE_TAG} ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO_NAME}:${IMAGE_TAG}
                docker tag ${ECR_REPO_NAME}:${IMAGE_TAG} ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO_NAME}:latest
                docker push ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO_NAME}:${IMAGE_TAG}
                docker push ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO_NAME}:latest
                """
            }
        }

        stage('Deploy to Amazon ECS') {
            steps {
                echo 'Triggering new deployment on Amazon ECS...'
                sh """
                aws ecs update-service --cluster ${ECS_CLUSTER} --service ${ECS_SERVICE} --force-new-deployment --region ${AWS_REGION}
                """
            }
        }
    }

    post {
        always {
            echo 'Cleaning up local images...'
            sh "docker rmi ${ECR_REPO_NAME}:${IMAGE_TAG} || true"
        }
        success {
            echo 'Pipeline completed successfully!'
        }
        failure {
            echo 'Pipeline failed. Check logs above.'
        }
    }
}
