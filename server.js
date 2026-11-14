/* =========================================================
   NOVATALK V4.0.0 — BACKEND COMPLET
   CONNECT THE WORLD 🌍
   BY MARUCE SOLDADO 🇬🇳
   ========================================================= */

"use strict";

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 10000;
const VERSION = "4.0.0";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const JWT_SECRET = process.env.JWT_SECRET;
const FRONTEND_URL = process.env.FRONTEND_URL || "*";

if (!SUPABASE_URL || !SUPABASE_KEY || !JWT_SECRET) {
  console.error("CONFIGURATION MANQUANTE");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

app.set("trust proxy", 1);

app.use(helmet({
  crossOriginResourcePolicy: {
    policy: "cross-origin"
  }
}));

app.use(cors({
  origin: FRONTEND_URL === "*"
    ? true
    : FRONTEND_URL.split(",").map(x => x.trim()),
  credentials: true
}));

app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({
  extended: true,
  limit: "15mb"
}));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 100,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    success: false,
    error: "Trop de requêtes. Réessaie dans une minute."
  }
});

app.use("/api", apiLimiter);

const asyncRoute = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const fail = (res, status, error) =>
  res.status(status).json({
    success: false,
    error
  });

const dbError = (res, error, status = 400) => {
  console.error("SUPABASE:", error?.message || error);
  return fail(
    res,
    status,
    error?.message || "Erreur de base de données."
  );
};

const cleanText = (value, max = 5000) =>
  typeof value === "string"
    ? value.trim().slice(0, max)
    : "";

const validUuid = value =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

function makeToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

const auth = asyncRoute(async (req, res, next) => {
  const header = req.headers.authorization || "";

  const token = header.startsWith("Bearer ")
    ? header.slice(7)
    : null;

  if (!token) {
    return fail(res, 401, "Connexion requise.");
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);

    req.userId = payload.sub;
    req.username = payload.username || "";

    next();
  } catch {
    return fail(
      res,
      401,
      "Session expirée. Reconnecte-toi."
    );
  }
});

async function getUserById(id) {
  const { data, error } = await supabase
    .from("novatalk_users")
    .select("id, full_name, username, created_at")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;

  return data;
}

async function notify(
  userId,
  actorId,
  type,
  title,
  message,
  referenceId,
  referenceType
) {
  if (!userId || userId === actorId) return;

  const { error } = await supabase
    .from("novatalk_notifications")
    .insert({
      user_id: userId,
      actor_id: actorId || null,
      notification_type: type,
      title: title || null,
      message: message || null,
      reference_id: referenceId || null,
      reference_type: referenceType || null
    });

  if (error) {
    console.error(
      "Notification non créée:",
      error.message
    );
  }
}

async function isBlockedEitherWay(a, b) {
  const { data, error } = await supabase
    .from("novatalk_blocks")
    .select("id")
    .or(
      `and(blocker_id.eq.${a},blocked_id.eq.${b}),and(blocker_id.eq.${b},blocked_id.eq.${a})`
    )
    .limit(1);

  if (error) throw error;

  return !!(data && data.length);
}

async function areFriends(a, b) {
  const { data, error } = await supabase
    .from("novatalk_friends")
    .select("id")
    .eq("user_id", a)
    .eq("friend_id", b)
    .maybeSingle();

  if (error) throw error;

  return !!data;
}

async function ensureProfile(user) {
  if (!user) return null;

  const { data: existing, error: readError } =
    await supabase
      .from("novatalk_profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

  if (readError) throw readError;

  if (existing) return existing;

  const { data, error } = await supabase
    .from("novatalk_profiles")
    .insert({
      user_id: user.id,
      display_name: user.full_name || user.username,
      username: user.username
    })
    .select("*")
    .single();

  if (error) throw error;

  return data;
}

async function ensureSettings(userId) {
  const { data: existing, error: readError } =
    await supabase
      .from("novatalk_user_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

  if (readError) throw readError;

  if (existing) return existing;

  const { data, error } = await supabase
    .from("novatalk_user_settings")
    .insert({ user_id: userId })
    .select("*")
    .single();

  if (error) throw error;

  return data;
}

/* SYSTEME */

app.get("/", (req, res) => {
  res.json({
    success: true,
    app: "NOVATALK",
    slogan: "CONNECT THE WORLD",
    creator: "MARUCE SOLDADO 🇬🇳",
    version: VERSION
  });
});

app.get("/health", asyncRoute(async (req, res) => {
  const { error } = await supabase
    .from("novatalk_users")
    .select("id")
    .limit(1);

  if (error) {
    return res.status(503).json({
      success: false,
      server: "online",
      database: "error",
      version: VERSION,
      message: error.message
    });
  }

  res.json({
    success: true,
    server: "online",
    database: "configured",
    version: VERSION
  });
}));

/* INSCRIPTION */

async function registerHandler(req, res) {
  const full_name = cleanText(
    req.body.full_name || req.body.name,
    100
  );

  const username = cleanText(
    req.body.username,
    30
  ).replace(/^@/, "").toLowerCase();

  const password =
    typeof req.body.password === "string"
      ? req.body.password
      : "";

  if (full_name.length < 2) {
    return fail(res, 400, "Entre ton nom complet.");
  }

  if (!/^[a-z0-9_.]{3,30}$/.test(username)) {
    return fail(
      res,
      400,
      "Nom d'utilisateur invalide."
    );
  }

  if (password.length < 6) {
    return fail(
      res,
      400,
      "Le mot de passe doit contenir au moins 6 caractères."
    );
  }

  const { data: duplicate, error: checkError } =
    await supabase
      .from("novatalk_users")
      .select("id")
      .eq("username", username)
      .maybeSingle();

  if (checkError) {
    return dbError(res, checkError, 500);
  }

  if (duplicate) {
    return fail(
      res,
      409,
      "Ce nom d'utilisateur est déjà utilisé."
    );
  }

  const password_hash = await bcrypt.hash(
    password,
    12
  );

  const { data: user, error } = await supabase
    .from("novatalk_users")
    .insert({
      full_name,
      username,
      password_hash
    })
    .select("id, full_name, username, created_at")
    .single();

  if (error) {
    return dbError(res, error);
  }

  try {
    await ensureProfile(user);
    await ensureSettings(user.id);
  } catch (e) {
    console.error(
      "Initialisation profil/paramètres:",
      e.message
    );
  }

  return res.status(201).json({
    success: true,
    message: "Compte créé avec succès.",
    token: makeToken(user),
    user
  });
}

/* CONNEXION */

async function loginHandler(req, res) {
  const username = cleanText(
    req.body.username,
    30
  ).replace(/^@/, "").toLowerCase();

  const password =
    typeof req.body.password === "string"
      ? req.body.password
      : "";

  if (!username || !password) {
    return fail(
      res,
      400,
      "Entre ton nom d'utilisateur et ton mot de passe."
    );
  }

  const { data: user, error } = await supabase
    .from("novatalk_users")
    .select("id, full_name, username, password_hash, created_at")
    .eq("username", username)
    .maybeSingle();

  if (error) {
    return dbError(res, error, 500);
  }

  if (
    !user ||
    !(await bcrypt.compare(password, user.password_hash))
  ) {
    return fail(
      res,
      401,
      "Nom d'utilisateur ou mot de passe incorrect."
    );
  }

  const safeUser = {
    id: user.id,
    full_name: user.full_name,
    username: user.username,
    created_at: user.created_at
  };

  try {
    await ensureProfile(safeUser);
    await ensureSettings(user.id);
  } catch (e) {
    console.error(
      "Initialisation profil/paramètres:",
      e.message
    );
  }

  res.json({
    success: true,
    token: makeToken(safeUser),
    user: safeUser
  });
}

app.post(
  "/api/auth/register",
  asyncRoute(registerHandler)
);

app.post(
  "/api/register",
  asyncRoute(registerHandler)
);

app.post(
  "/api/auth/login",
  asyncRoute(loginHandler)
);

app.post(
  "/api/login",
  asyncRoute(loginHandler)
);

app.get("/api/auth/me", auth, asyncRoute(async (req, res) => {
  const user = await getUserById(req.userId);

  if (!user) {
    return fail(res, 404, "Utilisateur introuvable.");
  }

  res.json({
    success: true,
    user
  });
}));

app.get("/api/profile", auth, asyncRoute(async (req, res) => {
  const user = await getUserById(req.userId);
  const profile = await ensureProfile(user);

  res.json({
    success: true,
    user,
    profile
  });
}));

app.post("/api/auth/logout", auth, (req, res) => {
  res.json({
    success: true,
    message: "Déconnexion effectuée sur cet appareil."
  });
});/* =========================================================
   PARTIE 2 — UTILISATEURS, AMIS ET MESSAGERIE
   ========================================================= */

/* ================= RECHERCHE UTILISATEURS ================= */

app.get("/api/users", auth, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();

    if (q.length < 2) {
      return res.json({ success: true, users: [] });
    }

    const { data, error } = await supabase
      .from("novatalk_users")
      .select("id, full_name, username, created_at")
      .or(`username.ilike.%${q}%,full_name.ilike.%${q}%`)
      .neq("id", req.user.id)
      .limit(20);

    if (error) throw error;

    const users = data || [];

    res.json({
      success: true,
      users
    });
  } catch (error) {
    console.error("USER SEARCH:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de rechercher les utilisateurs"
    });
  }
});

app.get("/api/users/search", auth, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();

    if (q.length < 2) {
      return res.json({ success: true, users: [] });
    }

    const { data, error } = await supabase
      .from("novatalk_users")
      .select("id, full_name, username, created_at")
      .or(`username.ilike.%${q}%,full_name.ilike.%${q}%`)
      .neq("id", req.user.id)
      .limit(20);

    if (error) throw error;

    res.json({
      success: true,
      users: data || []
    });
  } catch (error) {
    console.error("USER SEARCH:", error);
    res.status(500).json({
      success: false,
      error: "Erreur pendant la recherche"
    });
  }
});


/* ================= DEMANDES D'AMITIÉ ================= */

app.get("/api/friend-requests", auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("novatalk_friend_requests")
      .select("*")
      .or(`sender_id.eq.${req.user.id},receiver_id.eq.${req.user.id}`)
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      requests: data || []
    });
  } catch (error) {
    console.error("FRIEND REQUESTS:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de charger les demandes"
    });
  }
});


app.post("/api/friend-requests", auth, async (req, res) => {
  try {
    const receiverId = String(req.body.receiver_id || "").trim();

    if (!receiverId || receiverId === req.user.id) {
      return res.status(400).json({
        success: false,
        error: "Utilisateur invalide"
      });
    }

    const blocked = await isBlockedEitherWay(req.user.id, receiverId);

    if (blocked) {
      return res.status(403).json({
        success: false,
        error: "Cette action n'est pas autorisée"
      });
    }

    const { data: existing, error: existingError } = await supabase
      .from("novatalk_friend_requests")
      .select("id, status")
      .or(
        `and(sender_id.eq.${req.user.id},receiver_id.eq.${receiverId}),and(sender_id.eq.${receiverId},receiver_id.eq.${req.user.id})`
      )
      .maybeSingle();

    if (existingError) throw existingError;

    if (existing && existing.status === "pending") {
      return res.status(409).json({
        success: false,
        error: "Une demande est déjà en attente"
      });
    }

    const { data: friendship } = await supabase
      .from("novatalk_friends")
      .select("id")
      .eq("user_id", req.user.id)
      .eq("friend_id", receiverId)
      .maybeSingle();

    if (friendship) {
      return res.status(409).json({
        success: false,
        error: "Vous êtes déjà amis"
      });
    }

    const { data, error } = await supabase
      .from("novatalk_friend_requests")
      .insert({
        sender_id: req.user.id,
        receiver_id: receiverId,
        status: "pending"
      })
      .select()
      .single();

    if (error) throw error;

    await notify(
      receiverId,
      req.user.id,
      "friend_request",
      "Nouvelle demande d'amitié",
      "Vous avez reçu une demande d'amitié",
      data.id,
      "friend_request"
    );

    res.status(201).json({
      success: true,
      request: data
    });
  } catch (error) {
    console.error("SEND FRIEND REQUEST:", error);
    res.status(500).json({
      success: false,
      error: "Impossible d'envoyer la demande"
    });
  }
});


app.post("/api/friend-requests/:id/respond", auth, async (req, res) => {
  try {
    const requestId = req.params.id;
    const action = String(req.body.action || "").toLowerCase();

    if (!["accept", "reject"].includes(action)) {
      return res.status(400).json({
        success: false,
        error: "Action invalide"
      });
    }

    const { data: request, error: requestError } = await supabase
      .from("novatalk_friend_requests")
      .select("*")
      .eq("id", requestId)
      .eq("receiver_id", req.user.id)
      .eq("status", "pending")
      .single();

    if (requestError || !request) {
      return res.status(404).json({
        success: false,
        error: "Demande introuvable"
      });
    }

    const newStatus = action === "accept" ? "accepted" : "rejected";

    const { error: updateError } = await supabase
      .from("novatalk_friend_requests")
      .update({ status: newStatus })
      .eq("id", requestId);

    if (updateError) throw updateError;

    if (action === "accept") {
      const { error: friendError } = await supabase
        .from("novatalk_friends")
        .upsert(
          [
            {
              user_id: req.user.id,
              friend_id: request.sender_id
            },
            {
              user_id: request.sender_id,
              friend_id: req.user.id
            }
          ],
          { onConflict: "user_id,friend_id" }
        );

      if (friendError) throw friendError;

      await notify(
        request.sender_id,
        req.user.id,
        "friend_accepted",
        "Demande acceptée",
        "Votre demande d'amitié a été acceptée",
        request.id,
        "friend_request"
      );
    }

    res.json({
      success: true,
      status: newStatus
    });
  } catch (error) {
    console.error("RESPOND FRIEND REQUEST:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de traiter cette demande"
    });
  }
});


/* ================= LISTE DES AMIS ================= */

app.get("/api/friends", auth, async (req, res) => {
  try {
    const { data: relations, error } = await supabase
      .from("novatalk_friends")
      .select("friend_id")
      .eq("user_id", req.user.id);

    if (error) throw error;

    const ids = (relations || []).map(item => item.friend_id);

    if (!ids.length) {
      return res.json({
        success: true,
        friends: []
      });
    }

    const { data: users, error: usersError } = await supabase
      .from("novatalk_users")
      .select("id, full_name, username, created_at")
      .in("id", ids);

    if (usersError) throw usersError;

    res.json({
      success: true,
      friends: users || []
    });
  } catch (error) {
    console.error("GET FRIENDS:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de charger les amis"
    });
  }
});


app.delete("/api/friends/:userId", auth, async (req, res) => {
  try {
    const friendId = req.params.userId;

    const { error } = await supabase
      .from("novatalk_friends")
      .delete()
      .or(
        `and(user_id.eq.${req.user.id},friend_id.eq.${friendId}),and(user_id.eq.${friendId},friend_id.eq.${req.user.id})`
      );

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error("DELETE FRIEND:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de supprimer cet ami"
    });
  }
});


/* ================= CONVERSATIONS ================= */

app.get("/api/conversations", auth, async (req, res) => {
  try {
    const { data: memberships, error: memberError } = await supabase
      .from("novatalk_conversation_members")
      .select("conversation_id")
      .eq("user_id", req.user.id);

    if (memberError) throw memberError;

    const conversationIds = (memberships || []).map(
      item => item.conversation_id
    );

    if (!conversationIds.length) {
      return res.json({
        success: true,
        conversations: []
      });
    }

    const { data: conversations, error } = await supabase
      .from("novatalk_conversations")
      .select("*")
      .in("id", conversationIds)
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      conversations: conversations || []
    });
  } catch (error) {
    console.error("GET CONVERSATIONS:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de charger les conversations"
    });
  }
});


app.post("/api/conversations", auth, async (req, res) => {
  try {
    const otherUserId = String(req.body.user_id || "").trim();

    if (!otherUserId || otherUserId === req.user.id) {
      return res.status(400).json({
        success: false,
        error: "Destinataire invalide"
      });
    }

    const blocked = await isBlockedEitherWay(req.user.id, otherUserId);

    if (blocked) {
      return res.status(403).json({
        success: false,
        error: "Vous ne pouvez pas démarrer cette conversation"
      });
    }

    const { data: otherUser, error: userError } = await supabase
      .from("novatalk_users")
      .select("id")
      .eq("id", otherUserId)
      .maybeSingle();

    if (userError) throw userError;

    if (!otherUser) {
      return res.status(404).json({
        success: false,
        error: "Utilisateur introuvable"
      });
    }

    const { data: myMemberships, error: myError } = await supabase
      .from("novatalk_conversation_members")
      .select("conversation_id")
      .eq("user_id", req.user.id);

    if (myError) throw myError;

    const myIds = (myMemberships || []).map(
      item => item.conversation_id
    );

    if (myIds.length) {
      const { data: otherMemberships, error: otherError } = await supabase
        .from("novatalk_conversation_members")
        .select("conversation_id")
        .eq("user_id", otherUserId)
        .in("conversation_id", myIds);

      if (otherError) throw otherError;

      if (otherMemberships && otherMemberships.length) {
        return res.json({
          success: true,
          conversation_id: otherMemberships[0].conversation_id,
          existing: true
        });
      }
    }

    const { data: conversation, error: conversationError } = await supabase
      .from("novatalk_conversations")
      .insert({})
      .select()
      .single();

    if (conversationError) throw conversationError;

    const { error: membershipError } = await supabase
      .from("novatalk_conversation_members")
      .insert([
        {
          conversation_id: conversation.id,
          user_id: req.user.id
        },
        {
          conversation_id: conversation.id,
          user_id: otherUserId
        }
      ]);

    if (membershipError) throw membershipError;

    res.status(201).json({
      success: true,
      conversation_id: conversation.id,
      conversation,
      existing: false
    });
  } catch (error) {
    console.error("CREATE CONVERSATION:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de créer la conversation"
    });
  }
});


/* ================= VÉRIFICATION MEMBRE ================= */

async function isConversationMember(conversationId, userId) {
  const { data, error } = await supabase
    .from("novatalk_conversation_members")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;

  return Boolean(data);
}


/* ================= CHARGER LES MESSAGES ================= */

app.get("/api/conversations/:id/messages", auth, async (req, res) => {
  try {
    const conversationId = req.params.id;

    const allowed = await isConversationMember(
      conversationId,
      req.user.id
    );

    if (!allowed) {
      return res.status(403).json({
        success: false,
        error: "Accès interdit à cette conversation"
      });
    }

    const { data, error } = await supabase
      .from("novatalk_messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(200);

    if (error) throw error;

    res.json({
      success: true,
      messages: data || []
    });
  } catch (error) {
    console.error("GET MESSAGES:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de charger les messages"
    });
  }
});


/* ================= ENVOYER UN MESSAGE ================= */

app.post("/api/conversations/:id/messages", auth, async (req, res) => {
  try {
    const conversationId = req.params.id;
    const content = String(req.body.content || "").trim();
    const replyTo = req.body.reply_to || null;

    if (!content) {
      return res.status(400).json({
        success: false,
        error: "Le message est vide"
      });
    }

    if (content.length > 10000) {
      return res.status(400).json({
        success: false,
        error: "Message trop long"
      });
    }

    const allowed = await isConversationMember(
      conversationId,
      req.user.id
    );

    if (!allowed) {
      return res.status(403).json({
        success: false,
        error: "Accès interdit"
      });
    }

    const { data: members, error: membersError } = await supabase
      .from("novatalk_conversation_members")
      .select("user_id")
      .eq("conversation_id", conversationId);

    if (membersError) throw membersError;

    for (const member of members || []) {
      if (member.user_id !== req.user.id) {
        const blocked = await isBlockedEitherWay(
          req.user.id,
          member.user_id
        );

        if (blocked) {
          return res.status(403).json({
            success: false,
            error: "Vous ne pouvez pas envoyer de message à cet utilisateur"
          });
        }
      }
    }

    const messageData = {
      conversation_id: conversationId,
      sender_id: req.user.id,
      content
    };

    if (replyTo) {
      messageData.reply_to = replyTo;
    }

    const { data: message, error } = await supabase
      .from("novatalk_messages")
      .insert(messageData)
      .select()
      .single();

    if (error) throw error;

    for (const member of members || []) {
      if (member.user_id !== req.user.id) {
        await notify(
          member.user_id,
          req.user.id,
          "new_message",
          "Nouveau message",
          "Vous avez reçu un nouveau message",
          message.id,
          "message"
        );
      }
    }

    res.status(201).json({
      success: true,
      message
    });
  } catch (error) {
    console.error("SEND MESSAGE:", error);
    res.status(500).json({
      success: false,
      error: "Impossible d'envoyer le message"
    });
  }
});/* =========================================================
   PARTIE 3 — PROFILS, ABONNEMENTS ET PUBLICATIONS
   ========================================================= */


/* ================= MODIFIER UN MESSAGE ================= */

app.patch("/api/messages/:id", auth, async (req, res) => {
  try {
    const messageId = req.params.id;
    const content = String(req.body.content || "").trim();

    if (!content || content.length > 10000) {
      return res.status(400).json({
        success: false,
        error: "Contenu invalide"
      });
    }

    const { data: message, error: findError } = await supabase
      .from("novatalk_messages")
      .select("*")
      .eq("id", messageId)
      .eq("sender_id", req.user.id)
      .single();

    if (findError || !message) {
      return res.status(404).json({
        success: false,
        error: "Message introuvable"
      });
    }

    const { data, error } = await supabase
      .from("novatalk_messages")
      .update({
        content,
        edited_at: new Date().toISOString()
      })
      .eq("id", messageId)
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      message: data
    });
  } catch (error) {
    console.error("EDIT MESSAGE:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de modifier le message"
    });
  }
});


/* ================= SUPPRIMER UN MESSAGE ================= */

app.delete("/api/messages/:id", auth, async (req, res) => {
  try {
    const messageId = req.params.id;

    const { data: message, error: findError } = await supabase
      .from("novatalk_messages")
      .select("id, sender_id")
      .eq("id", messageId)
      .single();

    if (findError || !message) {
      return res.status(404).json({
        success: false,
        error: "Message introuvable"
      });
    }

    if (message.sender_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: "Vous ne pouvez supprimer que vos messages"
      });
    }

    const { error } = await supabase
      .from("novatalk_messages")
      .update({
        deleted_at: new Date().toISOString()
      })
      .eq("id", messageId);

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error("DELETE MESSAGE:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de supprimer le message"
    });
  }
});


/* ================= MON PROFIL ================= */

app.get("/api/profile/me", auth, async (req, res) => {
  try {
    const profile = await ensureProfile(req.user.id);

    const { data: user, error } = await supabase
      .from("novatalk_users")
      .select("id, full_name, username, created_at")
      .eq("id", req.user.id)
      .single();

    if (error) throw error;

    res.json({
      success: true,
      user,
      profile
    });
  } catch (error) {
    console.error("MY PROFILE:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de charger votre profil"
    });
  }
});


/* ================= MODIFIER MON PROFIL ================= */

app.put("/api/profile", auth, async (req, res) => {
  try {
    const allowedFields = [
      "display_name",
      "bio",
      "avatar_url",
      "cover_url",
      "country",
      "website",
      "birth_date",
      "gender"
    ];

    const updates = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = String(req.body[field] ?? "").trim();
      }
    }

    if (updates.display_name && updates.display_name.length > 80) {
      return res.status(400).json({
        success: false,
        error: "Le nom affiché est trop long"
      });
    }

    if (updates.bio && updates.bio.length > 500) {
      return res.status(400).json({
        success: false,
        error: "La biographie ne peut pas dépasser 500 caractères"
      });
    }

    if (updates.website && !/^https?:\/\//i.test(updates.website)) {
      return res.status(400).json({
        success: false,
        error: "Le site web doit commencer par http:// ou https://"
      });
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("novatalk_profiles")
      .upsert({
        user_id: req.user.id,
        ...updates
      }, {
        onConflict: "user_id"
      })
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      profile: data
    });
  } catch (error) {
    console.error("UPDATE PROFILE:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de modifier votre profil"
    });
  }
});


/* ================= PROFIL PUBLIC ================= */

app.get("/api/profiles/:username", auth, async (req, res) => {
  try {
    const username = String(req.params.username || "").trim();

    const { data: user, error: userError } = await supabase
      .from("novatalk_users")
      .select("id, full_name, username, created_at")
      .eq("username", username)
      .maybeSingle();

    if (userError) throw userError;

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "Profil introuvable"
      });
    }

    const { data: profile, error: profileError } = await supabase
      .from("novatalk_profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileError) throw profileError;

    const { count: followers } = await supabase
      .from("novatalk_follows")
      .select("*", { count: "exact", head: true })
      .eq("following_id", user.id);

    const { count: following } = await supabase
      .from("novatalk_follows")
      .select("*", { count: "exact", head: true })
      .eq("follower_id", user.id);

    const { count: posts } = await supabase
      .from("novatalk_posts")
      .select("*", { count: "exact", head: true })
      .eq("author_id", user.id)
      .is("deleted_at", null);

    const { data: followRelation } = await supabase
      .from("novatalk_follows")
      .select("id")
      .eq("follower_id", req.user.id)
      .eq("following_id", user.id)
      .maybeSingle();

    res.json({
      success: true,
      user,
      profile,
      statistics: {
        followers: followers || 0,
        following: following || 0,
        posts: posts || 0
      },
      is_following: Boolean(followRelation),
      is_me: req.user.id === user.id
    });
  } catch (error) {
    console.error("PUBLIC PROFILE:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de charger ce profil"
    });
  }
});


/* ================= S'ABONNER À UN UTILISATEUR ================= */

app.post("/api/users/:id/follow", auth, async (req, res) => {
  try {
    const targetId = req.params.id;

    if (targetId === req.user.id) {
      return res.status(400).json({
        success: false,
        error: "Vous ne pouvez pas vous suivre vous-même"
      });
    }

    const blocked = await isBlockedEitherWay(req.user.id, targetId);

    if (blocked) {
      return res.status(403).json({
        success: false,
        error: "Cette action n'est pas autorisée"
      });
    }

    const { data: target, error: targetError } = await supabase
      .from("novatalk_users")
      .select("id")
      .eq("id", targetId)
      .maybeSingle();

    if (targetError) throw targetError;

    if (!target) {
      return res.status(404).json({
        success: false,
        error: "Utilisateur introuvable"
      });
    }

    const { data: targetSettings } = await supabase
      .from("novatalk_user_settings")
      .select("private_account")
      .eq("user_id", targetId)
      .maybeSingle();

    if (targetSettings?.private_account) {
      return res.status(403).json({
        success: false,
        error: "Ce compte est privé"
      });
    }

    const { data, error } = await supabase
      .from("novatalk_follows")
      .upsert({
        follower_id: req.user.id,
        following_id: targetId
      }, {
        onConflict: "follower_id,following_id",
        ignoreDuplicates: true
      })
      .select()
      .maybeSingle();

    if (error) throw error;

    await notify(
      targetId,
      req.user.id,
      "new_follower",
      "Nouvel abonné",
      "Une personne vient de s'abonner à votre profil",
      req.user.id,
      "profile"
    );

    res.json({
      success: true,
      following: true,
      relation: data || null
    });
  } catch (error) {
    console.error("FOLLOW USER:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de suivre cet utilisateur"
    });
  }
});


/* ================= SE DÉSABONNER ================= */

app.delete("/api/users/:id/follow", auth, async (req, res) => {
  try {
    const targetId = req.params.id;

    const { error } = await supabase
      .from("novatalk_follows")
      .delete()
      .eq("follower_id", req.user.id)
      .eq("following_id", targetId);

    if (error) throw error;

    res.json({
      success: true,
      following: false
    });
  } catch (error) {
    console.error("UNFOLLOW USER:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de se désabonner"
    });
  }
});


/* ================= LISTE DES ABONNÉS ================= */

app.get("/api/users/:id/followers", auth, async (req, res) => {
  try {
    const { data: relations, error } = await supabase
      .from("novatalk_follows")
      .select("follower_id, created_at")
      .eq("following_id", req.params.id)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw error;

    const ids = (relations || []).map(item => item.follower_id);

    if (!ids.length) {
      return res.json({
        success: true,
        users: []
      });
    }

    const { data: users, error: usersError } = await supabase
      .from("novatalk_users")
      .select("id, full_name, username")
      .in("id", ids);

    if (usersError) throw usersError;

    res.json({
      success: true,
      users: users || []
    });
  } catch (error) {
    console.error("GET FOLLOWERS:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de charger les abonnés"
    });
  }
});


/* ================= LISTE DES ABONNEMENTS ================= */

app.get("/api/users/:id/following", auth, async (req, res) => {
  try {
    const { data: relations, error } = await supabase
      .from("novatalk_follows")
      .select("following_id, created_at")
      .eq("follower_id", req.params.id)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw error;

    const ids = (relations || []).map(item => item.following_id);

    if (!ids.length) {
      return res.json({
        success: true,
        users: []
      });
    }

    const { data: users, error: usersError } = await supabase
      .from("novatalk_users")
      .select("id, full_name, username")
      .in("id", ids);

    if (usersError) throw usersError;

    res.json({
      success: true,
      users: users || []
    });
  } catch (error) {
    console.error("GET FOLLOWING:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de charger les abonnements"
    });
  }
});


/* ================= CRÉER UNE PUBLICATION ================= */

app.post("/api/posts", auth, async (req, res) => {
  try {
    const content = String(req.body.content || "").trim();
    const postType = req.body.post_type || "post";
    const visibility = req.body.visibility || "public";
    const location = req.body.location
      ? String(req.body.location).trim()
      : null;

    if (!["post", "reel"].includes(postType)) {
      return res.status(400).json({
        success: false,
        error: "Type de publication invalide"
      });
    }

    if (!["public", "friends", "followers", "private"].includes(visibility)) {
      return res.status(400).json({
        success: false,
        error: "Visibilité invalide"
      });
    }

    if (content.length > 10000) {
      return res.status(400).json({
        success: false,
        error: "Publication trop longue"
      });
    }

    const media = Array.isArray(req.body.media) ? req.body.media : [];

    if (media.length > 10) {
      return res.status(400).json({
        success: false,
        error: "Maximum 10 médias par publication"
      });
    }

    const { data: post, error } = await supabase
      .from("novatalk_posts")
      .insert({
        author_id: req.user.id,
        content,
        post_type: postType,
        visibility,
        location
      })
      .select()
      .single();

    if (error) throw error;

    if (media.length) {
      const mediaRows = media.map((item, index) => ({
        post_id: post.id,
        media_url: String(item.media_url || item.url || ""),
        media_type: item.media_type === "video" ? "video" : "image",
        thumbnail_url: item.thumbnail_url || null,
        position: index
      }));

      if (mediaRows.some(item => !/^https?:\/\//i.test(item.media_url))) {
        await supabase
          .from("novatalk_posts")
          .delete()
          .eq("id", post.id);

        return res.status(400).json({
          success: false,
          error: "Chaque média doit avoir une adresse URL valide"
        });
      }

      const { error: mediaError } = await supabase
        .from("novatalk_post_media")
        .insert(mediaRows);

      if (mediaError) throw mediaError;
    }

    const { data: postMedia } = await supabase
      .from("novatalk_post_media")
      .select("*")
      .eq("post_id", post.id)
      .order("position", { ascending: true });

    res.status(201).json({
      success: true,
      post: {
        ...post,
        media: postMedia || []
      }
    });
  } catch (error) {
    console.error("CREATE POST:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de publier"
    });
  }
});


/* ================= FIL D'ACTUALITÉ ================= */

app.get("/api/feed", auth, async (req, res) => {
  try {
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 20, 1),
      50
    );

    const { data: followed, error: followError } = await supabase
      .from("novatalk_follows")
      .select("following_id")
      .eq("follower_id", req.user.id);

    if (followError) throw followError;

    const followedIds = (followed || []).map(item => item.following_id);

    const authorIds = [...new Set([req.user.id, ...followedIds])];

    const { data: posts, error } = await supabase
      .from("novatalk_posts")
      .select("*")
      .in("author_id", authorIds)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;

    const visiblePosts = (posts || []).filter(post => {
      if (post.author_id === req.user.id) return true;
      if (post.visibility === "private") return false;
      if (post.visibility === "followers") {
        return followedIds.includes(post.author_id);
      }
      if (post.visibility === "friends") return false;
      return true;
    });

    const postIds = visiblePosts.map(post => post.id);

    let media = [];
    let reactions = [];
    let comments = [];

    if (postIds.length) {
      const mediaResult = await supabase
        .from("novatalk_post_media")
        .select("*")
        .in("post_id", postIds)
        .order("position", { ascending: true });

      if (mediaResult.error) throw mediaResult.error;
      media = mediaResult.data || [];

      const reactionResult = await supabase
        .from("novatalk_post_reactions")
        .select("post_id, user_id, reaction_type")
        .in("post_id", postIds);

      if (reactionResult.error) throw reactionResult.error;
      reactions = reactionResult.data || [];

      const commentResult = await supabase
        .from("novatalk_post_comments")
        .select("id, post_id, author_id, content, created_at")
        .in("post_id", postIds)
        .is("deleted_at", null);

      if (commentResult.error) throw commentResult.error;
      comments = commentResult.data || [];
    }

    const result = visiblePosts.map(post => ({
      ...post,
      media: media.filter(item => item.post_id === post.id),
      reactions: reactions.filter(item => item.post_id === post.id),
      comments_count: comments.filter(item => item.post_id === post.id).length,
      my_reaction: reactions.find(
        item => item.post_id === post.id && item.user_id === req.user.id
      )?.reaction_type || null
    }));

    res.json({
      success: true,
      posts: result
    });
  } catch (error) {
    console.error("GET FEED:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de charger le fil d'actualité"
    });
  }
});


/* ================= OBTENIR UNE PUBLICATION ================= */

app.get("/api/posts/:id", auth, async (req, res) => {
  try {
    const { data: post, error } = await supabase
      .from("novatalk_posts")
      .select("*")
      .eq("id", req.params.id)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) throw error;

    if (!post) {
      return res.status(404).json({
        success: false,
        error: "Publication introuvable"
      });
    }

    if (post.author_id !== req.user.id && post.visibility === "private") {
      return res.status(403).json({
        success: false,
        error: "Cette publication est privée"
      });
    }

    const { data: media, error: mediaError } = await supabase
      .from("novatalk_post_media")
      .select("*")
      .eq("post_id", post.id)
      .order("position", { ascending: true });

    if (mediaError) throw mediaError;

    res.json({
      success: true,
      post: {
        ...post,
        media: media || []
      }
    });
  } catch (error) {
    console.error("GET POST:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de charger la publication"
    });
  }
});


/* ================= MODIFIER UNE PUBLICATION ================= */

app.patch("/api/posts/:id", auth, async (req, res) => {
  try {
    const postId = req.params.id;
    const content = String(req.body.content || "").trim();

    if (content.length > 10000) {
      return res.status(400).json({
        success: false,
        error: "Publication trop longue"
      });
    }

    const { data, error } = await supabase
      .from("novatalk_posts")
      .update({
        content,
        edited_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq("id", postId)
      .eq("author_id", req.user.id)
      .is("deleted_at", null)
      .select()
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({
        success: false,
        error: "Publication introuvable ou accès refusé"
      });
    }

    res.json({
      success: true,
      post: data
    });
  } catch (error) {
    console.error("EDIT POST:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de modifier la publication"
    });
  }
});


/* ================= SUPPRIMER UNE PUBLICATION ================= */

app.delete("/api/posts/:id", auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("novatalk_posts")
      .update({
        deleted_at: new Date().toISOString()
      })
      .eq("id", req.params.id)
      .eq("author_id", req.user.id)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({
        success: false,
        error: "Publication introuvable ou accès refusé"
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("DELETE POST:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de supprimer la publication"
    });
  }
});/* =========================================================
   PARTIE 4 — COMMENTAIRES, RÉACTIONS, STORIES ET COLLECTIONS
   ========================================================= */


/* ================= COMMENTAIRES ================= */

app.get("/api/posts/:id/comments", auth, async (req, res) => {
  try {
    const { data: comments, error } = await supabase
      .from("novatalk_post_comments")
      .select("*")
      .eq("post_id", req.params.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(200);

    if (error) throw error;

    res.json({
      success: true,
      comments: comments || []
    });
  } catch (error) {
    console.error("GET COMMENTS:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de charger les commentaires"
    });
  }
});


app.post("/api/posts/:id/comments", auth, async (req, res) => {
  try {
    const postId = req.params.id;
    const content = String(req.body.content || "").trim();
    const parentId = req.body.parent_id || null;

    if (!content || content.length > 3000) {
      return res.status(400).json({
        success: false,
        error: "Commentaire invalide"
      });
    }

    const { data: post, error: postError } = await supabase
      .from("novatalk_posts")
      .select("id, author_id")
      .eq("id", postId)
      .is("deleted_at", null)
      .maybeSingle();

    if (postError) throw postError;

    if (!post) {
      return res.status(404).json({
        success: false,
        error: "Publication introuvable"
      });
    }

    if (parentId) {
      const { data: parent, error: parentError } = await supabase
        .from("novatalk_post_comments")
        .select("id, post_id")
        .eq("id", parentId)
        .eq("post_id", postId)
        .is("deleted_at", null)
        .maybeSingle();

      if (parentError) throw parentError;

      if (!parent) {
        return res.status(404).json({
          success: false,
          error: "Commentaire parent introuvable"
        });
      }
    }

    const { data, error } = await supabase
      .from("novatalk_post_comments")
      .insert({
        post_id: postId,
        author_id: req.user.id,
        content,
        parent_id: parentId
      })
      .select()
      .single();

    if (error) throw error;

    if (post.author_id !== req.user.id) {
      await notify(
        post.author_id,
        req.user.id,
        "post_comment",
        "Nouveau commentaire",
        "Quelqu'un a commenté votre publication",
        postId,
        "post"
      );
    }

    res.status(201).json({
      success: true,
      comment: data
    });
  } catch (error) {
    console.error("CREATE COMMENT:", error);
    res.status(500).json({
      success: false,
      error: "Impossible d'ajouter le commentaire"
    });
  }
});


/* ================= MODIFIER UN COMMENTAIRE ================= */

app.patch("/api/comments/:id", auth, async (req, res) => {
  try {
    const content = String(req.body.content || "").trim();

    if (!content || content.length > 3000) {
      return res.status(400).json({
        success: false,
        error: "Commentaire invalide"
      });
    }

    const { data, error } = await supabase
      .from("novatalk_post_comments")
      .update({
        content,
        edited_at: new Date().toISOString()
      })
      .eq("id", req.params.id)
      .eq("author_id", req.user.id)
      .is("deleted_at", null)
      .select()
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({
        success: false,
        error: "Commentaire introuvable"
      });
    }

    res.json({
      success: true,
      comment: data
    });
  } catch (error) {
    console.error("EDIT COMMENT:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de modifier le commentaire"
    });
  }
});


/* ================= SUPPRIMER UN COMMENTAIRE ================= */

app.delete("/api/comments/:id", auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("novatalk_post_comments")
      .update({
        deleted_at: new Date().toISOString()
      })
      .eq("id", req.params.id)
      .eq("author_id", req.user.id)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({
        success: false,
        error: "Commentaire introuvable"
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("DELETE COMMENT:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de supprimer le commentaire"
    });
  }
});


/* ================= RÉACTIONS AUX PUBLICATIONS ================= */

app.post("/api/posts/:id/reactions", auth, async (req, res) => {
  try {
    const postId = req.params.id;
    const allowedReactions = [
      "like",
      "love",
      "haha",
      "wow",
      "sad",
      "angry"
    ];

    const reactionType = String(req.body.reaction_type || "like");

    if (!allowedReactions.includes(reactionType)) {
      return res.status(400).json({
        success: false,
        error: "Réaction invalide"
      });
    }

    const { data: post, error: postError } = await supabase
      .from("novatalk_posts")
      .select("id, author_id")
      .eq("id", postId)
      .is("deleted_at", null)
      .maybeSingle();

    if (postError) throw postError;

    if (!post) {
      return res.status(404).json({
        success: false,
        error: "Publication introuvable"
      });
    }

    const { data, error } = await supabase
      .from("novatalk_post_reactions")
      .upsert({
        post_id: postId,
        user_id: req.user.id,
        reaction_type: reactionType
      }, {
        onConflict: "post_id,user_id"
      })
      .select()
      .single();

    if (error) throw error;

    if (post.author_id !== req.user.id) {
      await notify(
        post.author_id,
        req.user.id,
        "post_reaction",
        "Nouvelle réaction",
        "Quelqu'un a réagi à votre publication",
        postId,
        "post"
      );
    }

    res.json({
      success: true,
      reaction: data
    });
  } catch (error) {
    console.error("POST REACTION:", error);
    res.status(500).json({
      success: false,
      error: "Impossible d'ajouter la réaction"
    });
  }
});


app.delete("/api/posts/:id/reactions", auth, async (req, res) => {
  try {
    const { error } = await supabase
      .from("novatalk_post_reactions")
      .delete()
      .eq("post_id", req.params.id)
      .eq("user_id", req.user.id);

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error("DELETE REACTION:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de retirer la réaction"
    });
  }
});


/* ================= PARTAGER UNE PUBLICATION ================= */

app.post("/api/posts/:id/share", auth, async (req, res) => {
  try {
    const postId = req.params.id;
    const message = String(req.body.message || "").trim();

    const { data: post, error: postError } = await supabase
      .from("novatalk_posts")
      .select("id, author_id")
      .eq("id", postId)
      .is("deleted_at", null)
      .maybeSingle();

    if (postError) throw postError;

    if (!post) {
      return res.status(404).json({
        success: false,
        error: "Publication introuvable"
      });
    }

    const { data, error } = await supabase
      .from("novatalk_post_shares")
      .insert({
        post_id: postId,
        user_id: req.user.id,
        message
      })
      .select()
      .single();

    if (error) throw error;

    await notify(
      post.author_id,
      req.user.id,
      "post_shared",
      "Publication partagée",
      "Quelqu'un a partagé votre publication",
      postId,
      "post"
    );

    res.status(201).json({
      success: true,
      share: data
    });
  } catch (error) {
    console.error("SHARE POST:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de partager la publication"
    });
  }
});


/* ================= STORIES ================= */

app.get("/api/stories", auth, async (req, res) => {
  try {
    const { data: followed, error: followError } = await supabase
      .from("novatalk_follows")
      .select("following_id")
      .eq("follower_id", req.user.id);

    if (followError) throw followError;

    const ids = [
      req.user.id,
      ...(followed || []).map(item => item.following_id)
    ];

    const { data, error } = await supabase
      .from("novatalk_stories")
      .select("*")
      .in("user_id", ids)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      stories: data || []
    });
  } catch (error) {
    console.error("GET STORIES:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de charger les stories"
    });
  }
});


app.post("/api/stories", auth, async (req, res) => {
  try {
    const mediaUrl = String(req.body.media_url || "").trim();
    const mediaType = req.body.media_type || "image";
    const textContent = String(req.body.text_content || "").trim();
    const backgroundColor = String(
      req.body.background_color || "#071b16"
    );

    const visibility = req.body.visibility || "public";

    if (!["image", "video", "text"].includes(mediaType)) {
      return res.status(400).json({
        success: false,
        error: "Type de story invalide"
      });
    }

    if (!["public", "friends", "followers"].includes(visibility)) {
      return res.status(400).json({
        success: false,
        error: "Visibilité invalide"
      });
    }

    if (mediaType !== "text" && !/^https?:\/\//i.test(mediaUrl)) {
      return res.status(400).json({
        success: false,
        error: "Adresse média invalide"
      });
    }

    if (textContent.length > 1000) {
      return res.status(400).json({
        success: false,
        error: "Texte trop long"
      });
    }

    const { data, error } = await supabase
      .from("novatalk_stories")
      .insert({
        user_id: req.user.id,
        media_url: mediaType === "text" ? null : mediaUrl,
        media_type: mediaType,
        text_content: textContent,
        background_color: backgroundColor,
        visibility
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      story: data
    });
  } catch (error) {
    console.error("CREATE STORY:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de publier la story"
    });
  }
});


/* ================= VUES DES STORIES ================= */

app.post("/api/stories/:id/view", auth, async (req, res) => {
  try {
    const storyId = req.params.id;

    const { data: story, error: storyError } = await supabase
      .from("novatalk_stories")
      .select("id, user_id, expires_at")
      .eq("id", storyId)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (storyError) throw storyError;

    if (!story) {
      return res.status(404).json({
        success: false,
        error: "Story introuvable ou expirée"
      });
    }

    if (story.user_id === req.user.id) {
      return res.json({
        success: true,
        viewed: false
      });
    }

    const { error } = await supabase
      .from("novatalk_story_views")
      .upsert({
        story_id: storyId,
        viewer_id: req.user.id
      }, {
        onConflict: "story_id,viewer_id",
        ignoreDuplicates: true
      });

    if (error) throw error;

    res.json({
      success: true,
      viewed: true
    });
  } catch (error) {
    console.error("STORY VIEW:", error);
    res.status(500).json({
      success: false,
      error: "Impossible d'enregistrer la vue"
    });
  }
});


/* ================= LISTE DES VUES ================= */

app.get("/api/stories/:id/views", auth, async (req, res) => {
  try {
    const { data: story, error: storyError } = await supabase
      .from("novatalk_stories")
      .select("id, user_id")
      .eq("id", req.params.id)
      .maybeSingle();

    if (storyError) throw storyError;

    if (!story || story.user_id !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: "Accès interdit"
      });
    }

    const { data, error } = await supabase
      .from("novatalk_story_views")
      .select("viewer_id, viewed_at")
      .eq("story_id", req.params.id)
      .order("viewed_at", { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      views: data || []
    });
  } catch (error) {
    console.error("STORY VIEWS:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de charger les vues"
    });
  }
});


/* ================= SUPPRIMER UNE STORY ================= */

app.delete("/api/stories/:id", auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("novatalk_stories")
      .delete()
      .eq("id", req.params.id)
      .eq("user_id", req.user.id)
      .select("id")
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({
        success: false,
        error: "Story introuvable"
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("DELETE STORY:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de supprimer la story"
    });
  }
});


/* ================= COLLECTIONS ================= */

app.get("/api/collections", auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("novatalk_collections")
      .select("*")
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      collections: data || []
    });
  } catch (error) {
    console.error("GET COLLECTIONS:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de charger les collections"
    });
  }
});


app.post("/api/collections", auth, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const coverUrl = req.body.cover_url || null;
    const isPrivate = req.body.is_private !== false;

    if (!name || name.length > 80) {
      return res.status(400).json({
        success: false,
        error: "Nom de collection invalide"
      });
    }

    const { data, error } = await supabase
      .from("novatalk_collections")
      .insert({
        user_id: req.user.id,
        name,
        cover_url: coverUrl,
        is_private: isPrivate
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      collection: data
    });
  } catch (error) {
    console.error("CREATE COLLECTION:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de créer la collection"
    });
  }
});


/* ================= SUPPRIMER UNE COLLECTION ================= */

app.delete("/api/collections/:id", auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("novatalk_collections")
      .delete()
      .eq("id", req.params.id)
      .eq("user_id", req.user.id)
      .select("id")
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({
        success: false,
        error: "Collection introuvable"
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("DELETE COLLECTION:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de supprimer la collection"
    });
  }
});


/* ================= PUBLICATIONS ENREGISTRÉES ================= */

app.get("/api/saved-posts", auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("novatalk_saved_posts")
      .select("*")
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      saved_posts: data || []
    });
  } catch (error) {
    console.error("GET SAVED POSTS:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de charger les publications enregistrées"
    });
  }
});


/* ================= ENREGISTRER UNE PUBLICATION ================= */

app.post("/api/posts/:id/save", auth, async (req, res) => {
  try {
    const postId = req.params.id;
    const collectionId = req.body.collection_id || null;

    const { data: post, error: postError } = await supabase
      .from("novatalk_posts")
      .select("id")
      .eq("id", postId)
      .is("deleted_at", null)
      .maybeSingle();

    if (postError) throw postError;

    if (!post) {
      return res.status(404).json({
        success: false,
        error: "Publication introuvable"
      });
    }

    if (collectionId) {
      const { data: collection, error: collectionError } = await supabase
        .from("novatalk_collections")
        .select("id")
        .eq("id", collectionId)
        .eq("user_id", req.user.id)
        .maybeSingle();

      if (collectionError) throw collectionError;

      if (!collection) {
        return res.status(404).json({
          success: false,
          error: "Collection introuvable"
        });
      }
    }

    const { data, error } = await supabase
      .from("novatalk_saved_posts")
      .upsert({
        user_id: req.user.id,
        post_id: postId,
        collection_id: collectionId
      }, {
        onConflict: "user_id,post_id"
      })
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      saved_post: data
    });
  } catch (error) {
    console.error("SAVE POST:", error);
    res.status(500).json({
      success: false,
      error: "Impossible d'enregistrer la publication"
    });
  }
});


/* ================= RETIRER UNE PUBLICATION ENREGISTRÉE ================= */

app.delete("/api/posts/:id/save", auth, async (req, res) => {
  try {
    const { error } = await supabase
      .from("novatalk_saved_posts")
      .delete()
      .eq("user_id", req.user.id)
      .eq("post_id", req.params.id);

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error("UNSAVE POST:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de retirer la publication"
    });
  }
});/* =========================================================
   PARTIE 5 — NOTIFICATIONS, PARAMÈTRES ET SÉCURITÉ
   ========================================================= */


/* ================= NOTIFICATIONS ================= */

app.get("/api/notifications", auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("novatalk_notifications")
      .select("*")
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    const unread = (data || []).filter(item => !item.is_read).length;

    res.json({
      success: true,
      notifications: data || [],
      unread_count: unread
    });
  } catch (error) {
    console.error("GET NOTIFICATIONS:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de charger les notifications"
    });
  }
});


/* ================= MARQUER UNE NOTIFICATION COMME LUE ================= */

app.patch("/api/notifications/:id/read", auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("novatalk_notifications")
      .update({ is_read: true })
      .eq("id", req.params.id)
      .eq("user_id", req.user.id)
      .select()
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({
        success: false,
        error: "Notification introuvable"
      });
    }

    res.json({
      success: true,
      notification: data
    });
  } catch (error) {
    console.error("READ NOTIFICATION:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de modifier la notification"
    });
  }
});


/* ================= TOUT MARQUER COMME LU ================= */

app.post("/api/notifications/read-all", auth, async (req, res) => {
  try {
    const { error } = await supabase
      .from("novatalk_notifications")
      .update({ is_read: true })
      .eq("user_id", req.user.id)
      .eq("is_read", false);

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error("READ ALL NOTIFICATIONS:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de marquer les notifications comme lues"
    });
  }
});


/* ================= PARAMÈTRES DU COMPTE ================= */

app.get("/api/settings", auth, async (req, res) => {
  try {
    const settings = await ensureSettings(req.user.id);

    res.json({
      success: true,
      settings
    });
  } catch (error) {
    console.error("GET SETTINGS:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de charger les paramètres"
    });
  }
});


app.put("/api/settings", auth, async (req, res) => {
  try {
    const allowedFields = [
      "private_account",
      "allow_messages",
      "allow_comments",
      "allow_tagging",
      "show_online_status",
      "show_read_receipts",
      "push_notifications",
      "language",
      "theme"
    ];

    const updates = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    const booleanFields = [
      "private_account",
      "allow_messages",
      "allow_comments",
      "allow_tagging",
      "show_online_status",
      "show_read_receipts",
      "push_notifications"
    ];

    for (const field of booleanFields) {
      if (
        updates[field] !== undefined &&
        typeof updates[field] !== "boolean"
      ) {
        return res.status(400).json({
          success: false,
          error: `Valeur invalide pour ${field}`
        });
      }
    }

    if (updates.language !== undefined) {
      updates.language = String(updates.language).slice(0, 10);
    }

    if (updates.theme !== undefined) {
      if (!["light", "dark", "system"].includes(updates.theme)) {
        return res.status(400).json({
          success: false,
          error: "Thème invalide"
        });
      }
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("novatalk_user_settings")
      .upsert({
        user_id: req.user.id,
        ...updates
      }, {
        onConflict: "user_id"
      })
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      settings: data
    });
  } catch (error) {
    console.error("UPDATE SETTINGS:", error);
    res.status(500).json({
      success: false,
      error: "Impossible d'enregistrer les paramètres"
    });
  }
});


/* ================= BLOQUER UN UTILISATEUR ================= */

app.post("/api/blocks/:userId", auth, async (req, res) => {
  try {
    const blockedId = req.params.userId;

    if (!blockedId || blockedId === req.user.id) {
      return res.status(400).json({
        success: false,
        error: "Utilisateur invalide"
      });
    }

    const { data: target, error: targetError } = await supabase
      .from("novatalk_users")
      .select("id")
      .eq("id", blockedId)
      .maybeSingle();

    if (targetError) throw targetError;

    if (!target) {
      return res.status(404).json({
        success: false,
        error: "Utilisateur introuvable"
      });
    }

    const { data, error } = await supabase
      .from("novatalk_blocks")
      .upsert({
        blocker_id: req.user.id,
        blocked_id: blockedId
      }, {
        onConflict: "blocker_id,blocked_id"
      })
      .select()
      .single();

    if (error) throw error;

    // Retirer les relations d'amitié dans les deux sens.
    const { error: friendError } = await supabase
      .from("novatalk_friends")
      .delete()
      .or(
        `and(user_id.eq.${req.user.id},friend_id.eq.${blockedId}),and(user_id.eq.${blockedId},friend_id.eq.${req.user.id})`
      );

    if (friendError) throw friendError;

    // Retirer les abonnements dans les deux sens.
    const { error: followError } = await supabase
      .from("novatalk_follows")
      .delete()
      .or(
        `and(follower_id.eq.${req.user.id},following_id.eq.${blockedId}),and(follower_id.eq.${blockedId},following_id.eq.${req.user.id})`
      );

    if (followError) throw followError;

    res.json({
      success: true,
      block: data
    });
  } catch (error) {
    console.error("BLOCK USER:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de bloquer cet utilisateur"
    });
  }
});


/* ================= DÉBLOQUER UN UTILISATEUR ================= */

app.delete("/api/blocks/:userId", auth, async (req, res) => {
  try {
    const { error } = await supabase
      .from("novatalk_blocks")
      .delete()
      .eq("blocker_id", req.user.id)
      .eq("blocked_id", req.params.userId);

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error("UNBLOCK USER:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de débloquer cet utilisateur"
    });
  }
});


/* ================= LISTE DES UTILISATEURS BLOQUÉS ================= */

app.get("/api/blocks", auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("novatalk_blocks")
      .select("id, blocked_id, created_at")
      .eq("blocker_id", req.user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const ids = (data || []).map(item => item.blocked_id);

    let users = [];

    if (ids.length) {
      const { data: userData, error: userError } = await supabase
        .from("novatalk_users")
        .select("id, full_name, username")
        .in("id", ids);

      if (userError) throw userError;
      users = userData || [];
    }

    res.json({
      success: true,
      blocked_users: users
    });
  } catch (error) {
    console.error("GET BLOCKS:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de charger les utilisateurs bloqués"
    });
  }
});


/* ================= SIGNALER UN CONTENU OU UN UTILISATEUR ================= */

app.post("/api/reports", auth, async (req, res) => {
  try {
    const reportedUserId = req.body.reported_user_id || null;
    const postId = req.body.post_id || null;
    const reason = String(req.body.reason || "").trim();
    const description = String(req.body.description || "").trim();

    const allowedReasons = [
      "spam",
      "harassment",
      "violence",
      "hate",
      "nudity",
      "fake_account",
      "scam",
      "other"
    ];

    if (!allowedReasons.includes(reason)) {
      return res.status(400).json({
        success: false,
        error: "Motif de signalement invalide"
      });
    }

    if (!reportedUserId && !postId) {
      return res.status(400).json({
        success: false,
        error: "Précisez un utilisateur ou une publication"
      });
    }

    if (reportedUserId === req.user.id) {
      return res.status(400).json({
        success: false,
        error: "Vous ne pouvez pas vous signaler vous-même"
      });
    }

    if (description.length > 2000) {
      return res.status(400).json({
        success: false,
        error: "Description trop longue"
      });
    }

    if (reportedUserId) {
      const { data: target, error: targetError } = await supabase
        .from("novatalk_users")
        .select("id")
        .eq("id", reportedUserId)
        .maybeSingle();

      if (targetError) throw targetError;

      if (!target) {
        return res.status(404).json({
          success: false,
          error: "Utilisateur signalé introuvable"
        });
      }
    }

    if (postId) {
      const { data: post, error: postError } = await supabase
        .from("novatalk_posts")
        .select("id")
        .eq("id", postId)
        .maybeSingle();

      if (postError) throw postError;

      if (!post) {
        return res.status(404).json({
          success: false,
          error: "Publication signalée introuvable"
        });
      }
    }

    const { data, error } = await supabase
      .from("novatalk_reports")
      .insert({
        reporter_id: req.user.id,
        reported_user_id: reportedUserId,
        post_id: postId,
        reason,
        description,
        status: "pending"
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      report: data
    });
  } catch (error) {
    console.error("CREATE REPORT:", error);
    res.status(500).json({
      success: false,
      error: "Impossible d'envoyer le signalement"
    });
  }
});/* =========================================================
   PARTIE 6/6 — GROUPES + FIN DU SERVEUR
   NOVATALK V4 — BY MARUCE SOLDADO 🇬🇳
   ========================================================= */

/* ================= GROUPES ================= */

// Liste des groupes
app.get("/api/groups", auth, async (req, res) => {
  try {
    const { data: memberships, error } = await supabase
      .from("novatalk_group_members")
      .select("group_id, role, joined_at")
      .eq("user_id", req.user.id);

    if (error) throw error;

    const groupIds = (memberships || []).map(item => item.group_id);

    if (!groupIds.length) {
      return res.json({ success: true, groups: [] });
    }

    const { data: groups, error: groupError } = await supabase
      .from("novatalk_groups")
      .select("*")
      .in("id", groupIds)
      .order("created_at", { ascending: false });

    if (groupError) throw groupError;

    const result = (groups || []).map(group => ({
      ...group,
      membership: memberships.find(
        item => item.group_id === group.id
      )
    }));

    res.json({ success: true, groups: result });

  } catch (error) {
    console.error("GROUPS GET:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de charger les groupes"
    });
  }
});


// Créer un groupe
app.post("/api/groups", auth, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const description = String(req.body.description || "").trim();
    const privacy = req.body.privacy === "private"
      ? "private"
      : "public";

    if (name.length < 2 || name.length > 80) {
      return res.status(400).json({
        success: false,
        error: "Le nom du groupe doit contenir entre 2 et 80 caractères"
      });
    }

    const { data: group, error } = await supabase
      .from("novatalk_groups")
      .insert({
        creator_id: req.user.id,
        name,
        description,
        privacy
      })
      .select()
      .single();

    if (error) throw error;

    const { error: memberError } = await supabase
      .from("novatalk_group_members")
      .insert({
        group_id: group.id,
        user_id: req.user.id,
        role: "admin"
      });

    if (memberError) throw memberError;

    res.status(201).json({
      success: true,
      group
    });

  } catch (error) {
    console.error("GROUP CREATE:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de créer le groupe"
    });
  }
});


// Informations d'un groupe
app.get("/api/groups/:id", auth, async (req, res) => {
  try {
    const { data: group, error } = await supabase
      .from("novatalk_groups")
      .select("*")
      .eq("id", req.params.id)
      .maybeSingle();

    if (error) throw error;

    if (!group) {
      return res.status(404).json({
        success: false,
        error: "Groupe introuvable"
      });
    }

    const { data: membership } = await supabase
      .from("novatalk_group_members")
      .select("id")
      .eq("group_id", group.id)
      .eq("user_id", req.user.id)
      .maybeSingle();

    if (group.privacy === "private" && !membership) {
      return res.status(403).json({
        success: false,
        error: "Ce groupe est privé"
      });
    }

    res.json({
      success: true,
      group,
      is_member: Boolean(membership)
    });

  } catch (error) {
    console.error("GROUP DETAILS:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de charger ce groupe"
    });
  }
});


// Rejoindre un groupe public
app.post("/api/groups/:id/join", auth, async (req, res) => {
  try {
    const { data: group, error } = await supabase
      .from("novatalk_groups")
      .select("*")
      .eq("id", req.params.id)
      .maybeSingle();

    if (error) throw error;

    if (!group) {
      return res.status(404).json({
        success: false,
        error: "Groupe introuvable"
      });
    }

    if (group.privacy === "private") {
      return res.status(403).json({
        success: false,
        error: "Ce groupe est privé"
      });
    }

    const { data: existing } = await supabase
      .from("novatalk_group_members")
      .select("id")
      .eq("group_id", group.id)
      .eq("user_id", req.user.id)
      .maybeSingle();

    if (existing) {
      return res.json({
        success: true,
        message: "Tu es déjà membre de ce groupe"
      });
    }

    const { error: joinError } = await supabase
      .from("novatalk_group_members")
      .insert({
        group_id: group.id,
        user_id: req.user.id,
        role: "member"
      });

    if (joinError) throw joinError;

    res.json({
      success: true,
      message: "Tu as rejoint le groupe"
    });

  } catch (error) {
    console.error("GROUP JOIN:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de rejoindre ce groupe"
    });
  }
});


// Quitter un groupe
app.delete("/api/groups/:id/leave", auth, async (req, res) => {
  try {
    const { data: membership, error } = await supabase
      .from("novatalk_group_members")
      .select("*")
      .eq("group_id", req.params.id)
      .eq("user_id", req.user.id)
      .maybeSingle();

    if (error) throw error;

    if (!membership) {
      return res.status(404).json({
        success: false,
        error: "Tu n'es pas membre de ce groupe"
      });
    }

    const { error: deleteError } = await supabase
      .from("novatalk_group_members")
      .delete()
      .eq("id", membership.id);

    if (deleteError) throw deleteError;

    res.json({
      success: true,
      message: "Tu as quitté le groupe"
    });

  } catch (error) {
    console.error("GROUP LEAVE:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de quitter le groupe"
    });
  }
});


// Liste des membres d'un groupe
app.get("/api/groups/:id/members", auth, async (req, res) => {
  try {
    const { data: group, error: groupError } = await supabase
      .from("novatalk_groups")
      .select("id, privacy")
      .eq("id", req.params.id)
      .maybeSingle();

    if (groupError) throw groupError;

    if (!group) {
      return res.status(404).json({
        success: false,
        error: "Groupe introuvable"
      });
    }

    const { data: ownMembership } = await supabase
      .from("novatalk_group_members")
      .select("id")
      .eq("group_id", group.id)
      .eq("user_id", req.user.id)
      .maybeSingle();

    if (group.privacy === "private" && !ownMembership) {
      return res.status(403).json({
        success: false,
        error: "Accès réservé aux membres"
      });
    }

    const { data: members, error } = await supabase
      .from("novatalk_group_members")
      .select("id, user_id, role, joined_at")
      .eq("group_id", group.id)
      .order("joined_at", { ascending: true });

    if (error) throw error;

    res.json({
      success: true,
      members: members || []
    });

  } catch (error) {
    console.error("GROUP MEMBERS:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de charger les membres"
    });
  }
});


// Ajouter un membre (administrateur ou modérateur)
app.post("/api/groups/:id/members", auth, async (req, res) => {
  try {
    const userId = String(req.body.user_id || "").trim();

    if (!userId) {
      return res.status(400).json({
        success: false,
        error: "Identifiant utilisateur obligatoire"
      });
    }

    const { data: actor, error: actorError } = await supabase
      .from("novatalk_group_members")
      .select("role")
      .eq("group_id", req.params.id)
      .eq("user_id", req.user.id)
      .maybeSingle();

    if (actorError) throw actorError;

    if (!actor || !["admin", "moderator"].includes(actor.role)) {
      return res.status(403).json({
        success: false,
        error: "Seuls les administrateurs et modérateurs peuvent ajouter un membre"
      });
    }

    const { data: existing } = await supabase
      .from("novatalk_group_members")
      .select("id")
      .eq("group_id", req.params.id)
      .eq("user_id", userId)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({
        success: false,
        error: "Cet utilisateur est déjà membre"
      });
    }

    const { error } = await supabase
      .from("novatalk_group_members")
      .insert({
        group_id: req.params.id,
        user_id: userId,
        role: "member"
      });

    if (error) throw error;

    res.status(201).json({
      success: true,
      message: "Membre ajouté"
    });

  } catch (error) {
    console.error("GROUP ADD MEMBER:", error);
    res.status(500).json({
      success: false,
      error: "Impossible d'ajouter ce membre"
    });
  }
});


// Retirer un membre
app.delete("/api/groups/:id/members/:userId", auth, async (req, res) => {
  try {
    const targetUserId = req.params.userId;

    const { data: actor, error: actorError } = await supabase
      .from("novatalk_group_members")
      .select("role")
      .eq("group_id", req.params.id)
      .eq("user_id", req.user.id)
      .maybeSingle();

    if (actorError) throw actorError;

    if (!actor || !["admin", "moderator"].includes(actor.role)) {
      return res.status(403).json({
        success: false,
        error: "Permission insuffisante"
      });
    }

    const { data: target, error: targetError } = await supabase
      .from("novatalk_group_members")
      .select("*")
      .eq("group_id", req.params.id)
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (targetError) throw targetError;

    if (!target) {
      return res.status(404).json({
        success: false,
        error: "Membre introuvable"
      });
    }

    if (target.role === "admin" && actor.role !== "admin") {
      return res.status(403).json({
        success: false,
        error: "Un modérateur ne peut pas retirer un administrateur"
      });
    }

    const { error } = await supabase
      .from("novatalk_group_members")
      .delete()
      .eq("id", target.id);

    if (error) throw error;

    res.json({
      success: true,
      message: "Membre retiré"
    });

  } catch (error) {
    console.error("GROUP REMOVE MEMBER:", error);
    res.status(500).json({
      success: false,
      error: "Impossible de retirer ce membre"
    });
  }
});


/* ================= ROUTE INCONNUE ================= */

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Route API introuvable",
    path: req.originalUrl
  });
});


/* ================= GESTION DES ERREURS ================= */

app.use((error, req, res, next) => {
  console.error("NOVATALK SERVER ERROR:", error);

  if (res.headersSent) {
    return next(error);
  }

  res.status(error.status || 500).json({
    success: false,
    error: "Une erreur interne est survenue"
  });
});


/* ================= DÉMARRAGE ================= */

app.listen(PORT, () => {
  console.log("--------------------------------------");
  console.log("NOVATALK V4 🌍");
  console.log("CONNECT THE WORLD");
  console.log("BY MARUCE SOLDADO 🇬🇳");
  console.log("PORT:", PORT);
  console.log("SUPABASE:", Boolean(supabase));
  console.log("SERVER: ONLINE");
  console.log("--------------------------------------");
});
