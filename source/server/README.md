# Matchmaker Server

This is the Express-powered REST-like API server for the Matchmaker system.

## Technical Overview

The server is a Node.js application that uses Express to handle HTTP requests and responses.

It features the following elements:

- **Frontend:** A basic landing page that instructs the user how to use the service.
- **API:** A REST-like API that allows authenticated clients to create profiles, save relations (match, pass, etc), and retrieve matches.

### Considerations

- The server is designed to be run on a single machine, and does not support clustering or load balancing out of the box. This shouldn't be a problem for the purposes of this exercise, but it's something to keep in mind if you were to use this code in a production environment.
  - A good idea for a production environment would be to use a reverse proxy like Nginx to handle load balancing and SSL termination, with sticky sessions enabled to ensure that a user always hits the same server. It is also essential to use a database that supports clustering, such as MariaDB or MongoDB. This will require some changes to the code, but it's not too difficult.
- All persistent data is stored as strings to keep things simple. This is not ideal for a production environment, as it would be better to use a database that supports more complex data types, such as JSON.
- The server does not support full-trust HTTPS and relies on TLS termination at the load balancer. This means the server can technically be MITM'd without proper HTTPS handling.
