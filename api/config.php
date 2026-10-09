<?php
/**
 * LINE Messaging API settings for the contact form.
 *
 * While channel_access_token or to is empty, the form runs in MOCK mode:
 * nothing is sent to LINE; each message is written to api/storage/line-mock.log instead.
 *
 * Where to get the values (LINE Developers console → the shop's OA → Messaging API channel):
 *   channel_access_token  "Channel access token (long-lived)" → Issue
 *   to                    who receives the notification:
 *                           - a staff member's userId (starts with "U…"), or
 *                           - a groupId (starts with "C…") after inviting the OA into the staff LINE group
 *
 * Keep this file private: never commit real tokens to git or paste them into front-end JS.
 */
return [
    'channel_access_token' => '',   // TODO: paste token here
    'to'                   => '',   // TODO: userId (U...) or groupId (C...)

    // force mock even when a token is set (e.g. on a staging server)
    'mock' => false,

    // requests allowed from these origins (Origin header); empty = allow any
    'allowed_origins' => [
        'https://anpperformance.com',
        'https://www.anpperformance.com',
        'http://localhost',
    ],

    // basic flood protection per IP
    'rate_limit' => ['max' => 5, 'window_seconds' => 600],

    'timezone' => 'Asia/Bangkok',
];
