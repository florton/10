const express = require('express')
const app = express()
const cors = require('cors')
const logger = require('morgan')
const { v4: uuidv4 } = require('uuid')

const port = 3000

const userSessions = {}
const invitations = {}
const ongoingMatches = {}

app.use(function (req, res, next) {
  console.log(req.originalUrl)
  next()
})

app.use(logger('dev'))
app.use(cors())

app.options('*', cors())

app.get('/', (req, res) => res.sendStatus(200))

// MATCH

const startMatch = (matchId, sessionId, challengerId) => {
  const maxHP = 10

  ongoingMatches[matchId] = {
    players: {
      [sessionId]: {
        health: maxHP,
        moves: []
      },
      [challengerId]: {
        health: maxHP,
        moves: []
      }
    },
    matchId: matchId,
    moveIndex: 0
  }

  userSessions[sessionId].status = 'in_match'
  userSessions[sessionId].matchId = matchId
  userSessions[challengerId].status = 'in_match'
  userSessions[challengerId].matchId = matchId
}

// LOBBY

const createSession = (id, userName) => {
  userSessions[id] = {
    sessionId: id,
    name: userName,
    status: 'lobby',
    matchId: null,
    lastActive: (new Date()).toISOString()
  }
}

app.get('/new_session/:userName', (req, res) => {
  const newUserId = uuidv4()
  const userName = req.params.userName

  if (Object.values(userSessions).filter((user) => user.name === userName).length >= 1) {
    // user already exists
    res.json({
      sessionId: null
    })
  } else {
    createSession(newUserId, userName)

    res.json({
      sessionId: newUserId
    })
  }
})

app.get('/list_users_in_lobby', (req, res) => {
  const result = []

  Object.values(userSessions).forEach((user) => {
    if (user.status === 'lobby') {
      result.push({
        sessionId: user.sessionId,
        name: user.name
      })
    }
  })

  res.json({
    users: result
  })
})

app.get('/challenge_user/:userName/:sessionId/:targetId', (req, res) => {
  const userName = req.params.userName
  const sessionId = req.params.sessionId
  const targetId = req.params.targetId

  if (!invitations[targetId]) {
    invitations[targetId] = []
  }

  invitations[targetId].push({
    challengerId: sessionId,
    challengerName: userName
  })

  res.json({message: 'OK'})
})

app.get('/accept_invite/:sessionId/:challengerId', (req, res) => {
  const sessionId = req.params.sessionId
  const challengerId = req.params.challengerId

  try {
    invitations[sessionId] = invitations[sessionId].filter((session) => session.challengerId !== challengerId)

    const matchId = uuidv4()

    startMatch(matchId, sessionId, challengerId)

    res.json({
      matchId: matchId
    })
  } catch (e) {
    res.json({
      matchId: null
    })
  }
})

app.get('/heartbeat_lobby/:sessionId/:userName', (req, res) => {
  const sessionId = req.params.sessionId
  const userName = req.params.userName

  if (userSessions[sessionId]) {
    userSessions[sessionId].lastActive = (new Date()).toISOString()
    userSessions[sessionId].status = 'lobby'
  } else {
    createSession(sessionId, userName)
  }

  res.json({
    invitations: invitations[sessionId] || [],
    matchId: userSessions[sessionId].matchId
  })
})

// APP

app.listen(port, () => console.log(`App listening at http://localhost:${port}`))
