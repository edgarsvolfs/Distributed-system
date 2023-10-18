const express = require('express');
const app = express();
const axios = require('axios');
const fs = require('fs');
const fileUpload = require('express-fileupload');
const multer = require('multer');
const Minio = require('minio');
const amqp = require('amqplib');
const nodemailer = require('nodemailer');

const apiKey = '637a409316c74cb593a1648b47d43e91';
const endpoint = 'https://westeurope.api.cognitive.microsoft.com';
const mongojs = require('mongojs');
//const db = mongojs('mongodb://localhost:27017/local', ['localcollection']);
const db = mongojs('mongodb://mongodb:27017/local', ['localcollection']);
const currentTime = new Date();


async function recognizePlateNumber(imageBuffer, apiKey, endpoint) {
    try {
        const response = await axios({
            method: 'post',
            url: `${endpoint}/vision/v3.0/ocr`,
            headers: {
                'Ocp-Apim-Subscription-Key': apiKey,
                'Content-Type': 'application/octet-stream'
            },
            params: {
                language: 'unk',
                detectOrientation: true,
                async: true,
                visualFeatures: "Description",
                description: {
                    "tags": [
                        "car",
                        "number plate",
                        "black on white"
                    ]
                }
            },
            data: imageBuffer
        });

        const regions = response.data.regions;
        const recognizedText = regions.map(region =>
            region.lines.map(line =>
                line.words.map(word => word.text).join(' ')
            ).join('\n')
        ).join('\n');

        return recognizedText;
    } catch (error) {
        console.error(error);
        throw error;
    }
}

function processPlateNumber(fileData, apiKey, endpoint) {
    return new Promise((resolve, reject) => {
        recognizePlateNumber(fileData, apiKey, endpoint)
            .then((plateNumberResult) => {
                db.localcollection.findOne({ message: plateNumberResult }, async (error, result) => {
                    if (error) {
                        console.error('Failed to find document:', error);
                        reject(error);
                        return;
                    }

                    //checks if the nameplate is already in the database
                    if (result) {
                        console.log('Document found:', result);
                        const timeDifference = currentTime - result.time;
                        console.log('currentTime:', currentTime);
                        console.log('result.time:', result.time);
                        const hours = Math.floor(timeDifference / (1000 * 60 * 60));
                        const minutes = Math.floor((timeDifference % (1000 * 60 * 60)) / (1000 * 60));
                        console.log('Time difference:', hours, 'hours', minutes, 'minutes');
                        const message = 'Parking space time spent is ' + hours + ' hours ' + minutes + ' minutes\n Car ' +
                            'Registration plate: ' + plateNumberResult;

                        const mailOptions = {
                            from: 'makonskaitlosana123@outlook.com',
                            to: 'dowifi8346@peogi.com',
                            subject: 'Parking information',
                            text: message
                        };

                        transporter.sendMail(mailOptions, function (error, info) {
                            if (error) {
                                console.log(error);
                                reject(error);
                            } else {
                                console.log('Email sent: ' + info.response);
                                resolve(plateNumberResult);
                            }
                        });

                        // db.close();
                    } else {
                        db.localcollection.insert({ message: plateNumberResult, time: currentTime }, (error, result) => {
                            if (error) {
                                console.error('Failed to insert document:', error);
                                reject(error);
                                return;
                            }

                            console.log('String inserted successfully:', result);
                            resolve(plateNumberResult);
                            // db.close();
                        });
                    }
                });
            })
            .catch((error) => {
                console.error('Error:', error);
                reject(error);
            });
    });
}

async function uploadRabbitMQ(queueName, message) {
    try {
        // Connect to the RabbitMQ server
        const connection = await amqp.connect('amqp://rabbitmq:5672'); // Replace with your RabbitMQ server connection URL
        const channel = await connection.createChannel();

        // Assert the queue to ensure it exists
        await channel.assertQueue(queueName, { durable: true });

        // Publish the message to the queue
        channel.sendToQueue(queueName, Buffer.from(message));

        console.log('Message published successfully');

        // Close the connection
        await channel.close();
        await connection.close();
    } catch (error) {
        console.error('Error:', error);
    }
}

// listener for rabbitmq messages
async function startConsumer() {
    try {
        console.log('consumer started');
        const connection = await amqp.connect('amqp://rabbitmq:5672'); // CHANGE TO rabbitmq:5672
        const channel = await connection.createChannel();
        const queueName = 'your-queue-name';

        await channel.assertQueue(queueName);

        channel.consume(queueName, (msg) => {
            const message = msg.content.toString();
            console.log('Received message:', message);


            // process for when rabbitmq recieves file name


            minioClient.getObject('your-bucket-name', message, (error, stream) => {
                if (error) {
                    console.error('Error:', error);
                    // Handle the error
                    return;
                }

                // Read the file data from the stream
                const chunks = [];

                stream.on('data', (chunk) => {
                    chunks.push(chunk);
                });

                stream.on('end', () => {
                    // Concatenate the file data chunks into a Buffer or process it as needed
                    const fileData = Buffer.concat(chunks);


                    // plate recognition
                    processPlateNumber(fileData, apiKey, endpoint);


                });

                stream.on('error', (error) => {
                    console.error('Error:', error);
                    // Handle the error
                });
            });


            channel.ack(msg); // Acknowledge the message to remove it from the queue
        });

        channel.on('error', (err) => {
            console.error('Channel error:', err);
        });

        connection.on('error', (err) => {
            console.error('Connection error:', err);
        });

        console.log('RabbitMQ consumer started');
    } catch (error) {
        console.error('Error starting RabbitMQ consumer:', error);
    }
}

module.exports = { startConsumer };

const minioClient = new Minio.Client({
    endPoint: 'minio', // Replace with your Minio server IP or hostname        // replace with minio
    port: 9000, // Replace with the Minio server port
    useSSL: false, // Set to true if your Minio server uses SSL
    accessKey: 'ueNGwRL2vRj0jG6YGRK3', // Replace with your Minio access key
    secretKey: 'PRTgfjiVtGlfmTCy3iTKERye0eoyh4bGvr7rohNm', // Replace with your Minio secret key
});

const transporter = nodemailer.createTransport({
    service: 'hotmail',
    auth: {
        user: 'makonskaitlosana123@outlook.com',
        pass: 'abc123456789!',
    },
    tls: {
        rejectUnauthorized: false
    }
});


app.use(express.json());
app.use(express.urlencoded({ extended: true }));
const upload = multer(); // Create an instance of multer

// sanem api req
app.post('/', upload.single('file'), (req, res) => {
    const imageBuffer = req.file.buffer;
    const file = req.file;
    const fileName = req.file.originalname;

    // upload file to Minio
    minioClient.putObject('your-bucket-name', file.originalname, file.buffer, (error, etag) => {
        if (error) {
            console.error('Error:', error);
        } else {
            console.log('File uploaded successfully. ETag:', etag);
        }
    });

    //uploads file name to rabbitmq
    uploadRabbitMQ('your-queue-name', fileName);
    res.send('Processing file upload');


});

// listener for rabbitmq
startConsumer();

app.listen(8000, () => {
    console.log('Server started on port 8000');
});