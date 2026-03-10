const fs = require("fs");
const http = require("http");
const https = require("https");

const credentials = require("./auth/credentials.json");

const DICTIONARY_KEY = process.env.DICTIONARY_KEY || credentials.dictionary_key;

const EBIRD_TOKEN = process.env.EBIRD_TOKEN || credentials.ebird_token;

const port = process.env.PORT || 3000;
const server = http.createServer();

server.on("listening", listen_handler);
server.listen(port);

function listen_handler() {
  console.log(`Now Listening on Port ${port}`);
}

server.on("request", request_handler);

function request_handler(req, res) {
  console.log(`New Request for ${req.url}`);

  if (req.url === "/") {
    const form = fs.createReadStream("html/index.html");
    res.writeHead(200, { "Content-Type": "text/html" });
    form.pipe(res);
    return;
  }

  if (req.url.startsWith("/mashup")) {
    const params = new URL(req.url, `https://${req.headers.host}`).searchParams;

    const word = params.get("word");
    const region = params.get("region");
    const maxResults = params.get("maxResults");
    const back = params.get("back");

    if (!word || !region || !maxResults || !back) {
      not_found(res);
      return;
    }

    get_dictionary_definition(word, { region, maxResults, back }, res);
    return;
  }

  not_found(res);
}

function not_found(res) {
  res.writeHead(404, { "Content-Type": "text/html" });
  res.end("<h1>404 Not Found</h1>");
}

/* API 1: Dictionary */

function get_dictionary_definition(word, ebird_input, res) {
  console.log("API 1 has been called: Dictionary");

  const path = `/api/v3/references/collegiate/json/${word}?key=${DICTIONARY_KEY}`;

  const options = {
    method: "GET",
    host: "dictionaryapi.com",
    path: path,
  };

  const dict_request = https.request(options);
  dict_request.on("response", (stream) =>
    process_stream(stream, receive_dictionary_results, word, ebird_input, res)
  );
  dict_request.end();
}

function receive_dictionary_results(body, word, ebird_input, res) {
  const dict = JSON.parse(body);

  // take the second defintion
  const definition =
    dict[0].def[0].sseq[1][0][1].dt[0][1].replace(/\{.*?\}/g, "");

  const dictionary_result = {
    word: word,
    definition: definition,
  };

  // after dictionary, get ebird data
  get_ebird_information(ebird_input, dictionary_result, res);
}

/* API 2: eBird */

function get_ebird_information(input, dictionary_result, res) {
  console.log("API 2 has been called: eBird");

  const { region, maxResults, back } = input;

  const path = `/v2/data/obs/${region}/recent?maxResults=${maxResults}&back=${back}`;

  const options = {
    method: "GET",
    host: "api.ebird.org",
    path: path,
    headers: {
      "X-eBirdApiToken": EBIRD_TOKEN,
    },
  };

  const ebird_request = https.request(options);
  ebird_request.on("response", (stream) =>
    process_stream(stream, receive_ebird_results, dictionary_result, res)
  );
  ebird_request.end();
}

function receive_ebird_results(body, dictionary_result, res) {
  const birds = JSON.parse(body);

  res.writeHead(200, { "Content-Type": "text/html" });

  res.write(`
    <h1>Dictionary + eBird Mashup</h1>

    <h2>Dictionary Result</h2>
    <p><b>Word:</b> ${dictionary_result.word}</p>
    <p><b>Definition:</b> ${dictionary_result.definition}</p>

    <hr>

    <h2>eBird Results</h2>
  `);

  birds.forEach((b) => {
    res.write(`
      <pre>
Common Name: ${b.comName}
Scientific Name: ${b.sciName}
Location Seen: ${b.locName}
Last time Seen: ${b.obsDt}
      </pre>
    `);
  });

  res.end(`<a href="/">Back</a>`);
}

/* Helper */

function process_stream(stream, callback, ...args) {
  let body = "";
  stream.on("data", (chunk) => (body += chunk));
  stream.on("end", () => callback(body, ...args));
}
