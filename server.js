const express = require('express')
const app = express()
const cors = require('cors')
const logger = require('morgan')
const { v4: uuidv4 } = require('uuid')
const { cloneDeep } = require('lodash')

// Globals

const garbageCollectFreq = 5 * 60 * 1000 // 2 minutes
const sessionTimeout = 5 * 60 * 1000 // 5 minutes
const matchTimeout = 5 * 60 * 1000 // 5 minutes
let runGarbageCollector = false

// RAM database lol

const userSessions = {}
const invitations = {}
const ongoingMatches = {}

// Express middleware

// app.use(function (req, res, next) {
//   console.log(req.originalUrl)
//   next()
// })

app.use(logger('dev'))
app.use(cors())

app.options('*', cors())

app.get('/', (req, res) => res.sendStatus(200))

// Utils

const garbageCollector = () => {
  console.log('Garbage Collect')
  Object.values(userSessions).forEach((userSession) => {
    // if userSession is older than sessionTimeout delete user session and invites
    if (new Date() - new Date(userSession.lastActive) > sessionTimeout) {
      delete invitations[userSession.sessionId]
      delete userSessions[userSession.sessionId]
    }
  })
  Object.values(ongoingMatches).forEach((match) => {
    // if match is older than matchTimeout delete
    if (new Date() - new Date(match.lastActive) > matchTimeout) {
      delete ongoingMatches[match.matchId]
    }
  })

  if (Object.keys(userSessions).length < 1) {
    runGarbageCollector = false
  } else {
    setTimeout(garbageCollector, garbageCollectFreq)
  }
}

// TODO: redirect reconnect from loby w/ match id into match
const createSession = (id, userName, status, matchId = null) => {
  userSessions[id] = {
    sessionId: id,
    name: userName,
    status,
    matchId,
    lastActive: (new Date()).toISOString()
  }

  if (!runGarbageCollector) {
    runGarbageCollector = true
    garbageCollector()
  }
}

const startMatch = (matchId, sessionId, challengerId) => {
  const maxHP = 10

  const player1StartsAttacking = Math.random() >= 0.5

  ongoingMatches[matchId] = {
    matchId: matchId,
    moveIndex: 0,
    winner: null,
    lastActive: (new Date()).toISOString(),
    players: {
      [sessionId]: {
        id: sessionId,
        health: maxHP,
        isAttacking: player1StartsAttacking,
        moves: []
      },
      [challengerId]: {
        id: challengerId,
        health: maxHP,
        isAttacking: !player1StartsAttacking,
        moves: []
      }
    }
  }

  userSessions[sessionId].status = 'in_match'
  userSessions[sessionId].matchId = matchId
  userSessions[challengerId].status = 'in_match'
  userSessions[challengerId].matchId = matchId
}

const calculateTurn = (match, player1Id, player1Move, player2Id, player2Move) => {
  const matchCopy = cloneDeep(match)
  const player1IsAttacking = match.players[player1Id].isAttacking
  const attackerMove = player1IsAttacking ? player1Move : player2Move
  const defenderMove = player1IsAttacking ? player2Move : player1Move

  if (defenderMove === attackerMove) {
    matchCopy.players[player1Id].isAttacking = !player1IsAttacking
    matchCopy.players[player2Id].isAttacking = player1IsAttacking
  } else {
    const defenderID = player1IsAttacking ? player2Id : player1Id
    if (attackerMove === 1 || attackerMove === '1') {
      matchCopy.players[defenderID].health -= 2
    } else {
      matchCopy.players[defenderID].health -= 1
    }
  }
  if (matchCopy.players[player1Id].health <= 0) {
    matchCopy.winner = player2Id
  }
  if (matchCopy.players[player2Id].health <= 0) {
    matchCopy.winner = player1Id
  }
  matchCopy.moveIndex++
  return matchCopy
}

// LOBBY

app.get('/new_session/:userName', (req, res) => {
  const newUserId = uuidv4()
  const userName = req.params.userName

  if (Object.values(userSessions).filter((user) => user.name === userName).length >= 1) {
    // user already exists
    res.json({
      sessionId: null
    })
  } else {
    createSession(newUserId, userName, 'lobby')

    res.json({
      sessionId: newUserId
    })
  }
})

app.get('/list_users_in_lobby', (req, res) => {
  const userInactiveTime = 30 * 1000 // 30 seconds
  const result = []

  Object.values(userSessions).forEach((userSession) => {
    if (
      userSession.status === 'lobby' &&
      new Date() - new Date(userSession.lastActive) <= userInactiveTime
    ) {
      result.push({
        sessionId: userSession.sessionId,
        name: userSession.name
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
    challengerName: userName,
    id: uuidv4(),
    timeSent: (new Date()).toISOString()
  })

  res.json({message: 'OK'})
})

app.get('/accept_invite/:sessionId/:challengerId', (req, res) => {
  const sessionId = req.params.sessionId
  const challengerId = req.params.challengerId

  try {
    invitations[sessionId].forEach((invitation, index) => {
      if (invitation.challengerId === challengerId) {
        invitations[sessionId].splice(index, 1)
      }
    })
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
    createSession(sessionId, userName, 'lobby')
  }

  res.json({
    invitations: invitations[sessionId] || [],
    matchId: userSessions[sessionId].matchId
  })
})

// MATCH

app.get('/make_move/:sessionId/:matchId/:userMove', (req, res) => {
  const sessionId = req.params.sessionId
  const matchId = req.params.matchId
  const userMove = req.params.userMove

  const match = ongoingMatches[matchId]
  const moveIndex = match.moveIndex
  const players = match.players
  const player2 = Object.values(players).filter((player) => player.id !== sessionId)[0]

  // if you havent aready moved this turn
  if (players[sessionId].moves.length - 1 !== moveIndex) {
    ongoingMatches[matchId].players[sessionId].moves.push(userMove)
    // if other player already moved this turn, finsh turn
    if (player2.moves.length - 1 === moveIndex) {
      ongoingMatches[matchId] = calculateTurn(match, sessionId, userMove, player2.id, player2.moves[moveIndex])
    }
  } else {
    // change move
    ongoingMatches[matchId].players[sessionId].moves[moveIndex] = userMove
  }

  res.json({message: 'Moved'})
})

app.get('/heartbeat_match/:sessionId/:matchId', (req, res) => {
  const sessionId = req.params.sessionId
  const matchId = req.params.matchId

  if (userSessions[sessionId]) {
    userSessions[sessionId].lastActive = (new Date()).toISOString()
    ongoingMatches[matchId].lastActive = (new Date()).toISOString()
    userSessions[sessionId].status = 'in-match'

    if (ongoingMatches[matchId].winner) {
      userSessions[sessionId].matchId = null
      res.json({
        matchId: null,
        matchState: ongoingMatches[matchId]
      })
    } else {
      res.json({
        matchId: matchId,
        matchState: ongoingMatches[matchId]
      })
    }
  } else {
    // TODO: handle user getting garbage collected while in match
    // createSession(sessionId, userName, 'in-match', matchId)
    console.log('Error user in match with no session')
    res.json({
      matchId: null
    })
  }
})

// APP

const port = process.env.PORT || 3000

app.listen(port, () => console.log(`App listening on ${port}`))
