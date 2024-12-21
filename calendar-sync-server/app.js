//DO NOT DELETE:
// export GOOGLE_CLIENT_ID=664889605225-j15l3kk3adee0tov8k4k0vanjvgjhe6q.apps.googleusercontent.com
// export GOOGLE_CLIENT_SECRET=GOCSPX-hyDTcDzNVKkTIkMCkJmFnStw2MU
// export REDIRECT_URI=http://localhost:3000/oauth2callback
//664889605225-j15l3kk3adee0tov8k4k0vanjvgjhe6q.apps.googleusercontent.com - CLIENTID
//GOCSPX-hyDTcDzNVKkTIkMCkJmFnStw2MU - CLIENT SECRET
// PL TOKEN - ebf71fb2-1751-4253-8049-97d33b85e5f8
// MS CLIENT ID: P_k8Q~JkSmUPd0Sx7Zd53TuwHVOzhhShqsGRHcLA
// MS CLIENT SECRET: 88f19ed8-52a5-456d-a94c-93033c9d7014


require('dotenv').config();

// Assuming you have an authenticated OAuth2 client (oAuth2Client)

console.log(process.env.GOOGLE_CLIENT_ID);
console.log(process.env.GOOGLE_CLIENT_SECRET);
console.log(process.env.REDIRECT_URI);
const path = require('path');

const express = require('express');
const { google } = require('googleapis');

const OAuth2Client = google.auth.OAuth2;

const app = express();
const port = process.env.PORT || 3000;
app.use(express.static('public'));

// Configure OAuth2 client with your app's credentials
const oAuth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.REDIRECT_URI
);
const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

app.get('/', (req, res) => {
  console.log('Serving home page');
  res.sendFile(path.join(__dirname, 'public', 'home.html'));
});

// Redirect user to this endpoint for signing in with Google
app.get('/auth/google', (req, res) => {
  // Generate an authentication URL
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events'
    ]
  });

  // Redirect the user to Google's OAuth 2.0 server
  res.redirect(authUrl);
});

// After user consents, Google will redirect to this endpoint
app.get('/oauth2callback', async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);

    // Save the tokens to the user's session or a database for later use if needed
    // req.session.tokens = tokens; // Example if using sessions

    res.redirect('/listCalendars'); // Redirect to list calendars or some other page
    //res.send('Done');
  } catch (error) {
    console.error('Error during OAuth callback', error);
    res.status(500).send('Authentication failed');
  }
});

app.get('/listCalendars', async (req, res) => {
  // Ensure the user is authenticated
  if (!oAuth2Client.credentials) {
    return res.redirect('/auth/google');
  }

  try {
    const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });
    const calendarList = await calendar.calendarList.list();
    const personalCalendarIds = calendarList.data.items.map(calendar => calendar.id);

    // Now you have a list of calendar IDs, you can store them or pass them to the combine function
    // For example:
    combineCalendars(personalCalendarIds);

    res.send(`
    <html>
      <head><title>Processing</title></head>
      <body>
        <p id="message">Calendar IDs fetched, combining process started. Please wait...</p>
        <script>
          function checkStatus() {
            fetch('/checkStatus')
              .then(response => response.json())
              .then(data => {
                if (data.status === 'done') {
                  document.getElementById('message').innerText = 'Process complete! Your combined calendar is ready.';
                  setTimeout(() => {
                    window.location.href = '/';
                  }, 5000); // Show the message for 5 seconds before redirecting
                } else {
                  setTimeout(checkStatus, 3000); // Check every 3 seconds
                }
              });
          }
          checkStatus();
        </script>
      </body>
    </html>
  `);


  } catch (error) {
    console.error('Error fetching calendar list:', error);
    res.status(500).send('Error fetching calendar list');
  }
});

let isProcessing = true; // Set this to false when the process is complete

app.get('/checkStatus', (req, res) => {
  res.json({ status: isProcessing ? 'processing' : 'done' });
});

let combinedCalendarId;

async function findOrCreateCombinedCal() {
  console.log("Searching for CombinedCal...");

  const calendars = await calendar.calendarList.list();
  const combinedCal = calendars.data.items.find(cal => cal.summary === 'CombinedCal');

  if (combinedCal) {
    combinedCalendarId = combinedCal.id;
    console.log(`Found existing CombinedCal with ID: ${combinedCalendarId}`);
    return combinedCalendarId;
  } else {
    console.log("CombinedCal not found, creating new one...");
    const newCal = await calendar.calendars.insert({
      requestBody: {
        summary: 'CombinedCal',
      },
    });
    combinedCalendarId = newCal.data.id;
    console.log(`Created new CombinedCal with ID: ${combinedCalendarId}`);
    return combinedCalendarId;
  }
}


async function listAllEvents(calendarId) {
  const events = await calendar.events.list({
    calendarId: calendarId,
    timeMin: (new Date()).toISOString(), // List future events
    singleEvents: true,
    orderBy: 'startTime',
  });
  return events.data.items;
}

async function addEventsToCombinedCal(events, combinedCalendarId) {
  console.log(`Adding events to CombinedCal with ID: ${combinedCalendarId}`);

  let existingEvents;
  try {
    existingEvents = await listAllEvents(combinedCalendarId);
  } catch (error) {
    console.error('Error listing existing events:', error);
    throw error;
  }

  for (const event of events) {
    try {
      console.log(`Processing event: ${event.summary}`);
      const isDuplicate = existingEvents.some(existingEvent =>
        existingEvent.summary === event.summary &&
        existingEvent.start.dateTime === event.start.dateTime &&
        existingEvent.end.dateTime === event.end.dateTime
      );

      if (!isDuplicate) {
        console.log(`Adding event: ${event.summary}`);
        const newEvent = {
          summary: event.summary,
          description: event.description,
          start: event.start,
          end: event.end,
          // Include other fields that are necessary, but omit 'id', 'etag', 'htmlLink', 'iCalUID', etc.
        };

        await calendar.events.insert({
          calendarId: combinedCalendarId,
          requestBody: newEvent
        });
      } else {
        console.log(`Duplicate event found, skipping: ${event.summary}`);
      }
    } catch (error) {
      console.error(`Error adding event to CombinedCal: ${event.summary}`, error.message);
    }
  }
}


async function combineCalendars(personalCalendarIds) {
  const combinedCalendarId = await findOrCreateCombinedCal();
  isProcessing = false; // Set this to false when done

  // Assuming `personalCalendarIds` is an array of calendar IDs you want to combine
  for (const calendarId of personalCalendarIds) {
    const events = await listAllEvents(calendarId);
    await addEventsToCombinedCal(events, combinedCalendarId);
  }
}

app.listen(port, () => {
  console.log(`Server started on port ${port}`);
});
