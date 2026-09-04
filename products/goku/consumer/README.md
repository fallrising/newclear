# Goku Consumer

Goku Consumer is an MQTT consumer that processes URLs and uploads batches to the Goku API.

## Prerequisites

- Go 1.19 or later
- Docker (optional, for containerized deployment)
- Access to an MQTT broker
- Access to a running instance of Goku API

## Building and Running

### As a Binary

1. Clone the repository:
   ```
   git clone https://github.com/fallrising/goku-consumer.git
   cd goku-consumer
   ```

2. Build the binary:
   ```
   go build -o goku-consumer ./cmd/goku-consumer
   ```

3. Set up environment variables:
   ```
   export MQTT_BROKER=tcp://your-mqtt-broker:1883
   export CLIENT_ID=goku-consumer
   export TOPIC=urls
   export BATCH_SIZE=10
   export API_ENDPOINT=http://your-goku-api:8080/upload
   ```

4. Run the binary:
   ```
   ./goku-consumer
   ```

### As a Docker Container

You have two options for running Goku Consumer as a Docker container:

#### Option 1: Use the pre-built image from Docker Hub

1. Pull the image from Docker Hub:
   ```
   docker pull kccy/goku-consumer:latest
   ```

2. Run the Docker container:
   ```
   docker run -e MQTT_BROKER=tcp://your-mqtt-broker:1883 \
              -e CLIENT_ID=goku-consumer \
              -e TOPIC=urls \
              -e BATCH_SIZE=10 \
              -e API_ENDPOINT=http://your-goku-api:8080/upload \
              kccy/goku-consumer:latest
   ```

#### Option 2: Build the Docker image yourself

1. Build the Docker image:
   ```
   docker build -t goku-consumer .
   ```

2. Run the Docker container:
   ```
   docker run -e MQTT_BROKER=tcp://your-mqtt-broker:1883 \
              -e CLIENT_ID=goku-consumer \
              -e TOPIC=urls \
              -e BATCH_SIZE=10 \
              -e API_ENDPOINT=http://your-goku-api:8080/upload \
              goku-consumer
   ```

## Configuration

The following environment variables are used to configure the application:

- `MQTT_BROKER`: The address of your MQTT broker
- `CLIENT_ID`: The client ID to use when connecting to the MQTT broker
- `TOPIC`: The MQTT topic to subscribe to
- `BATCH_SIZE`: The number of URLs to process before sending to the API
- `API_ENDPOINT`: The endpoint of your Goku API instance

## Deploying to a Server

1. Build the binary for your target system (if different from your development machine):
   ```
   GOOS=linux GOARCH=amd64 go build -o goku-consumer ./cmd/goku-consumer
   ```

2. Transfer the binary to your server.

3. On the server, set up the necessary environment variables and run the binary.

Alternatively, if using Docker:

1. Pull the pre-built image from Docker Hub or build the image yourself.
2. On your server, run the Docker container with the appropriate environment variables.

## Contributing

Please read CONTRIBUTING.md for details on our code of conduct, and the process for submitting pull requests.

## License

This project is licensed under the MIT License - see the LICENSE file for details.