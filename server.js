/* =========================================================
   NOVATALK V4 🌍
   CONNECT THE WORLD
   BY MARUCE SOLDADO 🇬🇳
   SERVEUR COMPLET
   ========================================================= */

"use strict";

/* ================= IMPORTATIONS ================= */

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const { createClient } = require("@supabase/supabase-js");

/* ================= CONFIGURATION ================= */

const app = express();

const PORT = process.env.PORT || 3000;
const VERSION = "4.0.0";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY;

const JWT_SECRET = process.env.JWT_SECRET;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !JWT_SECRET) {
  console.error("ERREUR : Variables d'environnement manquantes.");
  process.exit(1);
}

/* ================= SUPABASE ================= */

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

/* ================= MIDDLEWARES ================= */

app.use(helmet({
  crossOriginResourcePolicy: false
}));

app.use(cors({
  origin: [
    "https://marucesoldado752-ux.github.io",
    "http://localhost:3000",
    "http://127.0.0.1:5500"
  ],
  methods: [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "OPTIONS"
  ],
  allowedHeaders: [
    "Content-Type",
    "Authorization"
  ]
}));

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({
  extended: true,
  limit: "10mb"
}));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Trop de requêtes. Réessayez plus tard."
  }
});

app.use("/api", limiter);

/* ================= OUTILS ================= */

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next))
      .catch(next);
  };
}

/* ================= UTILISATEUR ================= */

async function getUserById(id) {
  const { data, error } = await supabase
    .from("novatalk_users")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;

  return data;
}

/* ================= AUTHENTIFICATION ================= */

const auth = asyncRoute(async (req, res, next) => {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      error: "Authentification requise"
    });
  }

  const token = header.substring(7).trim();

  if (!token) {
    return res.status(401).json({
      success: false,
      error: "Token manquant"
    });
  }

  let payload;

  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({
      success: false,
      error: "Session invalide ou expirée"
    });
  }

  const user = await getUserById(payload.sub);

  if (!user) {
    return res.status(401).json({
      success: false,
      error: "Utilisateur introuvable"
    });
  }

  req.userId = user.id;
  req.username = user.username || "";

  req.user = {
    ...user,
    id: user.id
  };

  next();
});

/* ================= NOTIFICATIONS ================= */

async function notify(
  userId,
  actorId,
  type,
  title,
  message,
  referenceId = null,
  referenceType = null
) {
  const { error } = await supabase
    .from("novatalk_notifications")
    .insert({
      user_id: userId,
      actor_id: actorId,
      type,
      title,
      message,
      reference_id: referenceId,
      reference_type: referenceType,
      is_read: false
    });

  if (error) {
    console.error("NOTIFICATION ERROR:", error);
  }
}

/* ================= BLOQUER / VÉRIFIER ================= */

async function isBlockedEitherWay(userA, userB) {
  const { data, error } = await supabase
    .from("novatalk_blocks")
    .select("id")
    .or(
      `and(blocker_id.eq.${userA},blocked_id.eq.${userB}),and(blocker_id.eq.${userB},blocked_id.eq.${userA})`
    )
    .limit(1);

  if (error) throw error;

  return Boolean(data && data.length);
}

/* ================= AMITIÉ ================= */

async function areFriends(userA, userB) {
  const { data, error } = await supabase
    .from("novatalk_friends")
    .select("id")
    .eq("user_id", userA)
    .eq("friend_id", userB)
    .maybeSingle();

  if (error) throw error;

  return Boolean(data);
}

/* ================= PROFIL UTILISATEUR ================= */

async function ensureProfile(user) {
  if (!user || !user.id) {
    throw new Error("Utilisateur invalide");
  }

  const { data: existing, error: findError } =
    await supabase
      .from("novatalk_profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

  if (findError) throw findError;

  if (existing) return existing;

  const { data, error } = await supabase
    .from("novatalk_profiles")
    .insert({
      user_id: user.id,
      full_name: user.full_name || "",
      username: user.username || "",
      bio: "",
      avatar_url: null,
      cover_url: null
    })
    .select()
    .single();

  if (error) throw error;

  return data;
}

/* ================= PARAMÈTRES PAR DÉFAUT ================= */

async function ensureSettings(userId) {
  const { data: existing, error: findError } =
    await supabase
      .from("novatalk_user_settings")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

  if (findError) throw findError;

  if (existing) return existing;

  const { data, error } = await supabase
    .from("novatalk_user_settings")
    .insert({
      user_id: userId,
      private_account: false,
      allow_messages: true,
      allow_comments: true,
      allow_tagging: true,
      show_online_status: true,
      show_read_receipts: true,
      push_notifications: true,
      language: "fr",
      theme: "dark"
    })
    .select()
    .single();

  if (error) throw error;

  return data;
}

/* ================= ROUTE ACCUEIL ================= */

app.get("/", (req, res) => {
  res.json({
    success: true,
    application: "NOVATALK",
    slogan: "CONNECT THE WORLD",
    creator: "MARUCE SOLDADO 🇬🇳",
    version: VERSION,
    server: "online"
  });
});

/* ================= SANTÉ DU SERVEUR ================= */

app.get("/health", async (req, res) => {
  try {
    const { error } = await supabase
      .from("novatalk_users")
      .select("id")
      .limit(1);

    if (error) throw error;

    res.json({
      success: true,
      server: "online",
      database: "configured",
      version: VERSION
    });

  } catch (error) {
    console.error("HEALTH CHECK:", error);

    res.status(503).json({
      success: false,
      server: "online",
      database: "error",
      version: VERSION
    });
  }
});

/* =========================================================
   FIN PARTIE 1/4
   NE PAS AJOUTER app.listen() ICI.
   ========================================================= *//* =========================================================
   PARTIE 2/4 — COMPTES, PROFILS ET RELATIONS
   ========================================================= */

/* ================= INSCRIPTION ================= */

async function registerUser(req, res) {
  try {
    const fullName = String(req.body.full_name || "").trim();
    const username = String(req.body.username || "")
      .trim()
      .toLowerCase();

    const password = String(req.body.password || "");

    if (fullName.length < 2 || fullName.length > 80) {
      return res.status(400).json({
        success: false,
        error: "Nom complet invalide"
      });
    }

    if (!/^[a-z0-9_.]{3,30}$/.test(username)) {
      return res.status(400).json({
        success: false,
        error: "Nom d'utilisateur invalide (3 à 30 caractères)"
      });
    }

    if (password.length < 8 || password.length > 100) {
      return res.status(400).json({
        success: false,
        error: "Le mot de passe doit contenir au moins 8 caractères"
      });
    }

    const { data: existing, error: findError } =
      await supabase
        .from("novatalk_users")
        .select("id")
        .eq("username", username)
        .maybeSingle();

    if (findError) throw findError;

    if (existing) {
      return res.status(409).json({
        success: false,
        error: "Ce nom d'utilisateur est déjà utilisé"
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const { data: user, error } = await supabase
      .from("novatalk_users")
      .insert({
        full_name: fullName,
        username,
        password_hash: passwordHash
      })
      .select("id, full_name, username, created_at")
      .single();

    if (error) throw error;

    await ensureProfile(user);
    await ensureSettings(user.id);

    const token = jwt.sign(
      {
        sub: user.id,
        username: user.username
      },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    return res.status(201).json({
      success: true,
      message: "Compte créé avec succès",
      token,
      user
    });

  } catch (error) {
    console.error("REGISTER:", error);

    return res.status(500).json({
      success: false,
      error: "Impossible de créer le compte"
    });
  }
}

app.post("/api/auth/register", registerUser);
app.post("/api/register", registerUser);


/* ================= CONNEXION ================= */

async function loginUser(req, res) {
  try {
    const username = String(req.body.username || "")
      .trim()
      .toLowerCase();

    const password = String(req.body.password || "");

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: "Nom d'utilisateur et mot de passe obligatoires"
      });
    }

    const { data: user, error } = await supabase
      .from("novatalk_users")
      .select("*")
      .eq("username", username)
      .maybeSingle();

    if (error) throw error;

    if (!user) {
      return res.status(401).json({
        success: false,
        error: "Identifiants incorrects"
      });
    }

    const validPassword = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!validPassword) {
      return res.status(401).json({
        success: false,
        error: "Identifiants incorrects"
      });
    }

    const token = jwt.sign(
      {
        sub: user.id,
        username: user.username
      },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    delete user.password_hash;

    await ensureProfile(user);
    await ensureSettings(user.id);

    return res.json({
      success: true,
      message: "Connexion réussie",
      token,
      user
    });

  } catch (error) {
    console.error("LOGIN:", error);

    return res.status(500).json({
      success: false,
      error: "Impossible de se connecter"
    });
  }
}

app.post("/api/auth/login", loginUser);
app.post("/api/login", loginUser);


/* ================= UTILISATEUR CONNECTÉ ================= */

app.get("/api/auth/me", auth, async (req, res) => {
  try {
    const user = await getUserById(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "Utilisateur introuvable"
      });
    }

    delete user.password_hash;

    const profile = await ensureProfile(user);

    res.json({
      success: true,
      user,
      profile
    });

  } catch (error) {
    console.error("AUTH ME:", error);

    res.status(500).json({
      success: false,
      error: "Impossible de récupérer le compte"
    });
  }
});


/* ================= PROFIL PERSONNEL ================= */

app.get("/api/profile", auth, async (req, res) => {
  try {
    const user = await getUserById(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "Utilisateur introuvable"
      });
    }

    const profile = await ensureProfile(user);

    delete user.password_hash;

    res.json({
      success: true,
      user,
      profile
    });

  } catch (error) {
    console.error("GET PROFILE:", error);

    res.status(500).json({
      success: false,
      error: "Impossible de charger le profil"
    });
  }
});


app.get("/api/profile/me", auth, async (req, res) => {
  try {
    const user = await getUserById(req.user.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "Utilisateur introuvable"
      });
    }

    const profile = await ensureProfile(user);

    res.json({
      success: true,
      profile
    });

  } catch (error) {
    console.error("MY PROFILE:", error);

    res.status(500).json({
      success: false,
      error: "Impossible de charger le profil"
    });
  }
});


/* ================= MODIFIER SON PROFIL ================= */

app.put("/api/profile", auth, async (req, res) => {
  try {
    const allowedFields = [
      "full_name",
      "bio",
      "avatar_url",
      "cover_url",
      "website",
      "location"
    ];

    const updates = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = String(req.body[field] || "").trim();
      }
    }

    if (
      updates.full_name !== undefined &&
      (updates.full_name.length < 2 ||
       updates.full_name.length > 80)
    ) {
      return res.status(400).json({
        success: false,
        error: "Nom complet invalide"
      });
    }

    if (updates.bio && updates.bio.length > 500) {
      return res.status(400).json({
        success: false,
        error: "La biographie est trop longue"
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

    if (updates.full_name !== undefined) {
      const { error: userError } = await supabase
        .from("novatalk_users")
        .update({
          full_name: updates.full_name
        })
        .eq("id", req.user.id);

      if (userError) throw userError;
    }

    res.json({
      success: true,
      profile: data
    });

  } catch (error) {
    console.error("UPDATE PROFILE:", error);

    res.status(500).json({
      success: false,
      error: "Impossible de modifier le profil"
    });
  }
});


/* ================= PROFIL PUBLIC ================= */

app.get("/api/profiles/:username", auth, async (req, res) => {
  try {
    const username = String(req.params.username)
      .trim()
      .toLowerCase();

    const { data: user, error } = await supabase
      .from("novatalk_users")
      .select("id, full_name, username, created_at")
      .eq("username", username)
      .maybeSingle();

    if (error) throw error;

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "Profil introuvable"
      });
    }

    const profile = await ensureProfile(user);

    const { count: postsCount, error: postsError } =
      await supabase
        .from("novatalk_posts")
        .select("id", {
          count: "exact",
          head: true
        })
        .eq("user_id", user.id)
        .is("deleted_at", null);

    if (postsError) throw postsError;

    res.json({
      success: true,
      user,
      profile,
      posts_count: postsCount || 0
    });

  } catch (error) {
    console.error("PUBLIC PROFILE:", error);

    res.status(500).json({
      success: false,
      error: "Impossible de charger ce profil"
    });
  }
});


/* ================= RECHERCHE UTILISATEURS ================= */

app.get("/api/users", auth, async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();

    if (q.length < 2) {
      return res.json({
        success: true,
        users: []
      });
    }

    const { data, error } = await supabase
      .from("novatalk_users")
      .select("id, full_name, username")
      .or(
        `full_name.ilike.%${q}%,username.ilike.%${q}%`
      )
      .neq("id", req.user.id)
      .limit(30);

    if (error) throw error;

    res.json({
      success: true,
      users: data || []
    });

  } catch (error) {
    console.error("USERS SEARCH:", error);

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
      return res.json({
        success: true,
        users: []
      });
    }

    const { data, error } = await supabase
      .from("novatalk_users")
      .select("id, full_name, username")
      .or(
        `full_name.ilike.%${q}%,username.ilike.%${q}%`
      )
      .neq("id", req.user.id)
      .limit(30);

    if (error) throw error;

    res.json({
      success: true,
      users: data || []
    });

  } catch (error) {
    console.error("USER SEARCH:", error);

    res.status(500).json({
      success: false,
      error: "Impossible de rechercher les utilisateurs"
    });
  }
});


/* ================= ENVOYER UNE DEMANDE D'AMI ================= */

app.post("/api/friend-requests", auth, async (req, res) => {
  try {
    const receiverId = String(
      req.body.receiver_id || ""
    ).trim();

    if (!receiverId || receiverId === req.user.id) {
      return res.status(400).json({
        success: false,
        error: "Utilisateur invalide"
      });
    }

    const target = await getUserById(receiverId);

    if (!target) {
      return res.status(404).json({
        success: false,
        error: "Utilisateur introuvable"
      });
    }

    if (await isBlockedEitherWay(req.user.id, receiverId)) {
      return res.status(403).json({
        success: false,
        error: "Action impossible"
      });
    }

    if (await areFriends(req.user.id, receiverId)) {
      return res.status(409).json({
        success: false,
        error: "Vous êtes déjà amis"
      });
    }

    const { data: existing, error: findError } =
      await supabase
        .from("novatalk_friend_requests")
        .select("id, status")
        .eq("sender_id", req.user.id)
        .eq("receiver_id", receiverId)
        .maybeSingle();

    if (findError) throw findError;

    if (existing && existing.status === "pending") {
      return res.status(409).json({
        success: false,
        error: "Demande déjà envoyée"
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
      "Demande d'amitié",
      "Quelqu'un souhaite devenir ton ami",
      data.id,
      "friend_request"
    );

    res.status(201).json({
      success: true,
      request: data
    });

  } catch (error) {
    console.error("FRIEND REQUEST:", error);

    res.status(500).json({
      success: false,
      error: "Impossible d'envoyer la demande"
    });
  }
});


/* ================= LISTE DES DEMANDES REÇUES ================= */

app.get("/api/friend-requests", auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("novatalk_friend_requests")
      .select("*")
      .eq("receiver_id", req.user.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      requests: data || []
    });

  } catch (error) {
    console.error("GET FRIEND REQUESTS:", error);

    res.status(500).json({
      success: false,
      error: "Impossible de charger les demandes"
    });
  }
});


/* ================= ACCEPTER / REFUSER UNE DEMANDE ================= */

app.post(
  "/api/friend-requests/:id/respond",
  auth,
  async (req, res) => {
    try {
      const action = req.body.action;

      if (!["accept", "reject"].includes(action)) {
        return res.status(400).json({
          success: false,
          error: "Action invalide"
        });
      }

      const { data: request, error: findError } =
        await supabase
          .from("novatalk_friend_requests")
          .select("*")
          .eq("id", req.params.id)
          .eq("receiver_id", req.user.id)
          .eq("status", "pending")
          .maybeSingle();

      if (findError) throw findError;

      if (!request) {
        return res.status(404).json({
          success: false,
          error: "Demande introuvable"
        });
      }

      const newStatus = action === "accept"
        ? "accepted"
        : "rejected";

      const { error: updateError } = await supabase
        .from("novatalk_friend_requests")
        .update({ status: newStatus })
        .eq("id", request.id);

      if (updateError) throw updateError;

      if (action === "accept") {
        const { error: friendError } = await supabase
          .from("novatalk_friends")
          .upsert([
            {
              user_id: req.user.id,
              friend_id: request.sender_id
            },
            {
              user_id: request.sender_id,
              friend_id: req.user.id
            }
          ], {
            onConflict: "user_id,friend_id"
          });

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
        error: "Impossible de traiter la demande"
      });
    }
  }
);


/* ================= LISTE DES AMIS ================= */

app.get("/api/friends", auth, async (req, res) => {
  try {
    const { data: relations, error } = await supabase
      .from("novatalk_friends")
      .select("friend_id, created_at")
      .eq("user_id", req.user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const ids = (relations || []).map(item => item.friend_id);

    if (!ids.length) {
      return res.json({
        success: true,
        friends: []
      });
    }

    const { data: users, error: usersError } =
      await supabase
        .from("novatalk_users")
        .select("id, full_name, username")
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


/* ================= SUPPRIMER UN AMI ================= */

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

    res.json({
      success: true,
      message: "Ami supprimé"
    });

  } catch (error) {
    console.error("DELETE FRIEND:", error);

    res.status(500).json({
      success: false,
      error: "Impossible de supprimer cet ami"
    });
  }
});


/* ================= FIN PARTIE 2/4 ================= *//* =========================================================
   PARTIE 3/4 — MESSAGERIE ET RÉSEAU SOCIAL
   ========================================================= */


/* ================= CRÉER UNE CONVERSATION ================= */

app.post("/api/conversations", auth, async (req, res) => {
  try {
    const otherUserId = String(req.body.user_id || "").trim();

    if (!otherUserId || otherUserId === req.user.id) {
      return res.status(400).json({
        success: false,
        error: "Utilisateur invalide"
      });
    }

    const otherUser = await getUserById(otherUserId);

    if (!otherUser) {
      return res.status(404).json({
        success: false,
        error: "Utilisateur introuvable"
      });
    }

    if (await isBlockedEitherWay(req.user.id, otherUserId)) {
      return res.status(403).json({
        success: false,
        error: "Conversation non autorisée"
      });
    }

    const { data: existingMembers, error: membersError } =
      await supabase
        .from("novatalk_conversation_members")
        .select("conversation_id")
        .eq("user_id", req.user.id);

    if (membersError) throw membersError;

    for (const member of existingMembers || []) {
      const { data: otherMember, error } = await supabase
        .from("novatalk_conversation_members")
        .select("conversation_id")
        .eq("conversation_id", member.conversation_id)
        .eq("user_id", otherUserId)
        .maybeSingle();

      if (error) throw error;

      if (otherMember) {
        const { data: conversation } = await supabase
          .from("novatalk_conversations")
          .select("*")
          .eq("id", member.conversation_id)
          .eq("is_group", false)
          .maybeSingle();

        if (conversation) {
          return res.json({
            success: true,
            conversation: {
              ...conversation,
              conversation_id: conversation.id
            }
          });
        }
      }
    }

    const { data: conversation, error } = await supabase
      .from("novatalk_conversations")
      .insert({
        created_by: req.user.id,
        is_group: false
      })
      .select()
      .single();

    if (error) throw error;

    const { error: insertError } = await supabase
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

    if (insertError) throw insertError;

    res.status(201).json({
      success: true,
      conversation: {
        ...conversation,
        conversation_id: conversation.id
      }
    });

  } catch (error) {
    console.error("CREATE CONVERSATION:", error);

    res.status(500).json({
      success: false,
      error: "Impossible de créer la conversation"
    });
  }
});


/* ================= LISTE DES CONVERSATIONS ================= */

app.get("/api/conversations", auth, async (req, res) => {
  try {
    const { data: memberships, error } = await supabase
      .from("novatalk_conversation_members")
      .select("conversation_id")
      .eq("user_id", req.user.id);

    if (error) throw error;

    const ids = (memberships || []).map(item => item.conversation_id);

    if (!ids.length) {
      return res.json({
        success: true,
        conversations: []
      });
    }

    const { data, error: conversationError } = await supabase
      .from("novatalk_conversations")
      .select("*")
      .in("id", ids)
      .order("created_at", { ascending: false });

    if (conversationError) throw conversationError;

    res.json({
      success: true,
      conversations: (data || []).map(item => ({
        ...item,
        conversation_id: item.id
      }))
    });

  } catch (error) {
    console.error("GET CONVERSATIONS:", error);

    res.status(500).json({
      success: false,
      error: "Impossible de charger les conversations"
    });
  }
});


/* ================= VÉRIFIER L'ACCÈS À UNE CONVERSATION ================= */

async function checkConversationAccess(conversationId, userId) {
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

    const allowed = await checkConversationAccess(
      conversationId,
      req.user.id
    );

    if (!allowed) {
      return res.status(403).json({
        success: false,
        error: "Accès refusé à cette conversation"
      });
    }

    const { data, error } = await supabase
      .from("novatalk_messages")
      .select("*")
      .eq("conversation_id", conversationId)
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

    if (!content || content.length > 10000) {
      return res.status(400).json({
        success: false,
        error: "Message invalide"
      });
    }

    const allowed = await checkConversationAccess(
      conversationId,
      req.user.id
    );

    if (!allowed) {
      return res.status(403).json({
        success: false,
        error: "Accès refusé"
      });
    }

    const { data, error } = await supabase
      .from("novatalk_messages")
      .insert({
        conversation_id: conversationId,
        sender_id: req.user.id,
        content,
        message_type: "text"
      })
      .select()
      .single();

    if (error) throw error;

    const { error: updateError } = await supabase
      .from("novatalk_conversations")
      .update({
        updated_at: new Date().toISOString()
      })
      .eq("id", conversationId);

    if (updateError) throw updateError;

    res.status(201).json({
      success: true,
      message: data
    });

  } catch (error) {
    console.error("SEND MESSAGE:", error);

    res.status(500).json({
      success: false,
      error: "Impossible d'envoyer le message"
    });
  }
});


/* ================= MODIFIER UN MESSAGE ================= */

app.patch("/api/messages/:id", auth, async (req, res) => {
  try {
    const content = String(req.body.content || "").trim();

    if (!content || content.length > 10000) {
      return res.status(400).json({
        success: false,
        error: "Message invalide"
      });
    }

    const { data, error } = await supabase
      .from("novatalk_messages")
      .update({
        content,
        updated_at: new Date().toISOString()
      })
      .eq("id", req.params.id)
      .eq("sender_id", req.user.id)
      .select()
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({
        success: false,
        error: "Message introuvable"
      });
    }

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
    const { data, error } = await supabase
      .from("novatalk_messages")
      .delete()
      .eq("id", req.params.id)
      .eq("sender_id", req.user.id)
      .select("id")
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({
        success: false,
        error: "Message introuvable"
      });
    }

    res.json({
      success: true
    });

  } catch (error) {
    console.error("DELETE MESSAGE:", error);

    res.status(500).json({
      success: false,
      error: "Impossible de supprimer le message"
    });
  }
});


/* ================= CRÉER UNE PUBLICATION ================= */

app.post("/api/posts", auth, async (req, res) => {
  try {
    const content = String(req.body.content || "").trim();
    const mediaUrl = req.body.media_url || null;
    const mediaType = req.body.media_type || null;

    if (!content && !mediaUrl) {
      return res.status(400).json({
        success: false,
        error: "La publication est vide"
      });
    }

    if (content.length > 10000) {
      return res.status(400).json({
        success: false,
        error: "Publication trop longue"
      });
    }

    const { data, error } = await supabase
      .from("novatalk_posts")
      .insert({
        user_id: req.user.id,
        content,
        media_url: mediaUrl,
        media_type: mediaType
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      post: data
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
    const { data, error } = await supabase
      .from("novatalk_posts")
      .select("*")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    res.json({
      success: true,
      posts: data || []
    });

  } catch (error) {
    console.error("GET FEED:", error);

    res.status(500).json({
      success: false,
      error: "Impossible de charger le fil d'actualité"
    });
  }
});


/* ================= MODIFIER UNE PUBLICATION ================= */

app.patch("/api/posts/:id", auth, async (req, res) => {
  try {
    const content = String(req.body.content || "").trim();

    if (!content || content.length > 10000) {
      return res.status(400).json({
        success: false,
        error: "Contenu invalide"
      });
    }

    const { data, error } = await supabase
      .from("novatalk_posts")
      .update({
        content,
        updated_at: new Date().toISOString()
      })
      .eq("id", req.params.id)
      .eq("user_id", req.user.id)
      .is("deleted_at", null)
      .select()
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({
        success: false,
        error: "Publication introuvable"
      });
    }

    res.json({
      success: true,
      post: data
    });

  } catch (error) {
    console.error("UPDATE POST:", error);

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
      .eq("user_id", req.user.id)
      .is("deleted_at", null)
      .select()
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({
        success: false,
        error: "Publication introuvable"
      });
    }

    res.json({
      success: true
    });

  } catch (error) {
    console.error("DELETE POST:", error);

    res.status(500).json({
      success: false,
      error: "Impossible de supprimer la publication"
    });
  }
});


/* ================= COMMENTAIRES ================= */

app.get("/api/posts/:id/comments", auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("novatalk_comments")
      .select("*")
      .eq("post_id", req.params.id)
      .order("created_at", { ascending: true });

    if (error) throw error;

    res.json({
      success: true,
      comments: data || []
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
    const content = String(req.body.content || "").trim();

    if (!content || content.length > 3000) {
      return res.status(400).json({
        success: false,
        error: "Commentaire invalide"
      });
    }

    const { data: post, error: postError } = await supabase
      .from("novatalk_posts")
      .select("id,user_id")
      .eq("id", req.params.id)
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
      .from("novatalk_comments")
      .insert({
        post_id: post.id,
        user_id: req.user.id,
        content
      })
      .select()
      .single();

    if (error) throw error;

    if (post.user_id !== req.user.id) {
      await notify(
        post.user_id,
        req.user.id,
        "comment",
        "Nouveau commentaire",
        "Quelqu'un a commenté ta publication",
        post.id,
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
      .from("novatalk_comments")
      .update({
        content,
        updated_at: new Date().toISOString()
      })
      .eq("id", req.params.id)
      .eq("user_id", req.user.id)
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
      .from("novatalk_comments")
      .delete()
      .eq("id", req.params.id)
      .eq("user_id", req.user.id)
      .select("id")
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({
        success: false,
        error: "Commentaire introuvable"
      });
    }

    res.json({
      success: true
    });

  } catch (error) {
    console.error("DELETE COMMENT:", error);

    res.status(500).json({
      success: false,
      error: "Impossible de supprimer le commentaire"
    });
  }
});


/* ================= RÉACTIONS ================= */

app.post("/api/posts/:id/reactions", auth, async (req, res) => {
  try {
    const reaction = String(req.body.reaction || "like");

    const allowed = [
      "like",
      "love",
      "haha",
      "wow",
      "sad",
      "angry"
    ];

    if (!allowed.includes(reaction)) {
      return res.status(400).json({
        success: false,
        error: "Réaction invalide"
      });
    }

    const { data: post, error: postError } = await supabase
      .from("novatalk_posts")
      .select("id,user_id")
      .eq("id", req.params.id)
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
      .from("novatalk_reactions")
      .upsert({
        user_id: req.user.id,
        post_id: post.id,
        reaction
      }, {
        onConflict: "user_id,post_id"
      })
      .select()
      .single();

    if (error) throw error;

    if (post.user_id !== req.user.id) {
      await notify(
        post.user_id,
        req.user.id,
        "reaction",
        "Nouvelle réaction",
        "Quelqu'un a réagi à ta publication",
        post.id,
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
      error: "Impossible d'enregistrer la réaction"
    });
  }
});


/* ================= RETIRER UNE RÉACTION ================= */

app.delete("/api/posts/:id/reactions", auth, async (req, res) => {
  try {
    const { error } = await supabase
      .from("novatalk_reactions")
      .delete()
      .eq("user_id", req.user.id)
      .eq("post_id", req.params.id);

    if (error) throw error;

    res.json({
      success: true
    });

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
    const { data: original, error: originalError } = await supabase
      .from("novatalk_posts")
      .select("*")
      .eq("id", req.params.id)
      .is("deleted_at", null)
      .maybeSingle();

    if (originalError) throw originalError;

    if (!original) {
      return res.status(404).json({
        success: false,
        error: "Publication introuvable"
      });
    }

    const { data, error } = await supabase
      .from("novatalk_posts")
      .insert({
        user_id: req.user.id,
        content: String(req.body.content || ""),
        shared_post_id: original.id
      })
      .select()
      .single();

    if (error) throw error;

    res.status(201).json({
      success: true,
      post: data
    });

  } catch (error) {
    console.error("SHARE POST:", error);

    res.status(500).json({
      success: false,
      error: "Impossible de partager la publication"
    });
  }
});


/* ================= SUIVRE UN UTILISATEUR ================= */

app.post("/api/users/:id/follow", auth, async (req, res) => {
  try {
    const targetId = req.params.id;

    if (targetId === req.user.id) {
      return res.status(400).json({
        success: false,
        error: "Tu ne peux pas te suivre toi-même"
      });
    }

    const target = await getUserById(targetId);

    if (!target) {
      return res.status(404).json({
        success: false,
        error: "Utilisateur introuvable"
      });
    }

    if (await isBlockedEitherWay(req.user.id, targetId)) {
      return res.status(403).json({
        success: false,
        error: "Action impossible"
      });
    }

    const { data, error } = await supabase
      .from("novatalk_follows")
      .upsert({
        follower_id: req.user.id,
        following_id: targetId
      }, {
        onConflict: "follower_id,following_id"
      })
      .select()
      .single();

    if (error) throw error;

    await notify(
      targetId,
      req.user.id,
      "follow",
      "Nouvel abonné",
      "Quelqu'un vient de te suivre",
      data.id,
      "follow"
    );

    res.json({
      success: true,
      follow: data
    });

  } catch (error) {
    console.error("FOLLOW USER:", error);

    res.status(500).json({
      success: false,
      error: "Impossible de suivre cet utilisateur"
    });
  }
});


/* ================= NE PLUS SUIVRE ================= */

app.delete("/api/users/:id/follow", auth, async (req, res) => {
  try {
    const { error } = await supabase
      .from("novatalk_follows")
      .delete()
      .eq("follower_id", req.user.id)
      .eq("following_id", req.params.id);

    if (error) throw error;

    res.json({
      success: true
    });

  } catch (error) {
    console.error("UNFOLLOW USER:", error);

    res.status(500).json({
      success: false,
      error: "Impossible de ne plus suivre cet utilisateur"
    });
  }
});


/* ================= ABONNÉS ================= */

app.get("/api/users/:id/followers", auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("novatalk_follows")
      .select("follower_id, created_at")
      .eq("following_id", req.params.id);

    if (error) throw error;

    const ids = (data || []).map(item => item.follower_id);

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
      followers: users
    });

  } catch (error) {
    console.error("GET FOLLOWERS:", error);

    res.status(500).json({
      success: false,
      error: "Impossible de charger les abonnés"
    });
  }
});


/* ================= ABONNEMENTS ================= */

app.get("/api/users/:id/following", auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("novatalk_follows")
      .select("following_id, created_at")
      .eq("follower_id", req.params.id);

    if (error) throw error;

    const ids = (data || []).map(item => item.following_id);

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
      following: users
    });

  } catch (error) {
    console.error("GET FOLLOWING:", error);

    res.status(500).json({
      success: false,
      error: "Impossible de charger les abonnements"
    });
  }
});


/* ================= FIN PARTIE 3/4 ================= *//* =========================================================
   PARTIE 4/4 — STORIES, COLLECTIONS, SÉCURITÉ ET GROUPES
   NOVATALK V4 🌍
   BY MARUCE SOLDADO 🇬🇳
   ========================================================= */


/* ================= STORIES ================= */

// Créer une story
app.post("/api/stories", auth, async (req, res) => {
  try {
    const mediaUrl = String(req.body.media_url || "").trim();
    const mediaType = String(req.body.media_type || "image");
    const caption = String(req.body.caption || "").trim();

    if (!mediaUrl) {
      return res.status(400).json({
        success: false,
        error: "Média obligatoire"
      });
    }

    if (!["image", "video"].includes(mediaType)) {
      return res.status(400).json({
        success: false,
        error: "Type de média invalide"
      });
    }

    const { data, error } = await supabase
      .from("novatalk_stories")
      .insert({
        user_id: req.user.id,
        media_url: mediaUrl,
        media_type: mediaType,
        caption,
        expires_at: new Date(
          Date.now() + 24 * 60 * 60 * 1000
        ).toISOString()
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
      error: "Impossible de créer la story"
    });
  }
});


// Liste des stories actives
app.get("/api/stories", auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("novatalk_stories")
      .select("*")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(100);

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


// Consulter une story
app.post("/api/stories/:id/view", auth, async (req, res) => {
  try {
    const { data: story, error: storyError } = await supabase
      .from("novatalk_stories")
      .select("id,user_id,expires_at")
      .eq("id", req.params.id)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (storyError) throw storyError;

    if (!story) {
      return res.status(404).json({
        success: false,
        error: "Story introuvable ou expirée"
      });
    }

    const { data, error } = await supabase
      .from("novatalk_story_views")
      .upsert({
        story_id: story.id,
        user_id: req.user.id
      }, {
        onConflict: "story_id,user_id"
      })
      .select()
      .single();

    if (error) throw error;

    res.json({
      success: true,
      view: data
    });

  } catch (error) {
    console.error("STORY VIEW:", error);

    res.status(500).json({
      success: false,
      error: "Impossible d'enregistrer la vue"
    });
  }
});


// Voir les consultations d'une story personnelle
app.get("/api/stories/:id/views", auth, async (req, res) => {
  try {
    const { data: story, error: storyError } = await supabase
      .from("novatalk_stories")
      .select("id")
      .eq("id", req.params.id)
      .eq("user_id", req.user.id)
      .maybeSingle();

    if (storyError) throw storyError;

    if (!story) {
      return res.status(404).json({
        success: false,
        error: "Story introuvable"
      });
    }

    const { data, error } = await supabase
      .from("novatalk_story_views")
      .select("*")
      .eq("story_id", story.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      views: data || []
    });

  } catch (error) {
    console.error("STORY VIEWS:", error);

    res.status(500).json({
      success: false,
      error: "Impossible de charger les consultations"
    });
  }
});


// Supprimer une story personnelle
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

// Liste des collections
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


// Créer une collection
app.post("/api/collections", auth, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();

    if (name.length < 2 || name.length > 80) {
      return res.status(400).json({
        success: false,
        error: "Nom de collection invalide"
      });
    }

    const { data, error } = await supabase
      .from("novatalk_collections")
      .insert({
        user_id: req.user.id,
        name
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


// Supprimer une collection
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


// Enregistrer une publication
app.post("/api/posts/:id/save", auth, async (req, res) => {
  try {
    const collectionId = req.body.collection_id || null;

    const { data: post, error: postError } = await supabase
      .from("novatalk_posts")
      .select("id")
      .eq("id", req.params.id)
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
      const { data: collection, error } = await supabase
        .from("novatalk_collections")
        .select("id")
        .eq("id", collectionId)
        .eq("user_id", req.user.id)
        .maybeSingle();

      if (error) throw error;

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
        post_id: post.id,
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


// Retirer une publication enregistrée
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
});


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

    const notifications = data || [];

    res.json({
      success: true,
      notifications,
      unread_count: notifications.filter(item => !item.is_read).length
    });

  } catch (error) {
    console.error("GET NOTIFICATIONS:", error);

    res.status(500).json({
      success: false,
      error: "Impossible de charger les notifications"
    });
  }
});


// Marquer une notification comme lue
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


// Tout marquer comme lu
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
      error: "Impossible de modifier les notifications"
    });
  }
});


/* ================= PARAMÈTRES ================= */

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

    if (
      updates.theme !== undefined &&
      !["light", "dark", "system"].includes(updates.theme)
    ) {
      return res.status(400).json({
        success: false,
        error: "Thème invalide"
      });
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

    const target = await getUserById(blockedId);

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


// Débloquer un utilisateur
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


// Liste des utilisateurs bloqués
app.get("/api/blocks", auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("novatalk_blocks")
      .select("id,blocked_id,created_at")
      .eq("blocker_id", req.user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const ids = (data || []).map(item => item.blocked_id);

    let users = [];

    if (ids.length) {
      const { data: userData, error: userError } = await supabase
        .from("novatalk_users")
        .select("id,full_name,username")
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


/* ================= SIGNALER UN CONTENU ================= */

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
});


/* ================= GROUPES ================= */

// Liste des groupes
app.get("/api/groups", auth, async (req, res) => {
  try {
    const { data: memberships, error } = await supabase
      .from("novatalk_group_members")
      .select("group_id,role,joined_at")
      .eq("user_id", req.user.id);

    if (error) throw error;

    const ids = (memberships || []).map(item => item.group_id);

    if (!ids.length) {
      return res.json({
        success: true,
        groups: []
      });
    }

    const { data, error: groupError } = await supabase
      .from("novatalk_groups")
      .select("*")
      .in("id", ids)
      .order("created_at", { ascending: false });

    if (groupError) throw groupError;

    res.json({
      success: true,
      groups: (data || []).map(group => ({
        ...group,
        membership: memberships.find(
          item => item.group_id === group.id
        )
      }))
    });

  } catch (error) {
    console.error("GET GROUPS:", error);

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
        error: "Nom de groupe invalide"
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
    console.error("CREATE GROUP:", error);

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

    const { data: membership, error: memberError } = await supabase
      .from("novatalk_group_members")
      .select("id")
      .eq("group_id", group.id)
      .eq("user_id", req.user.id)
      .maybeSingle();

    if (memberError) throw memberError;

    if (group.privacy === "private" && !membership) {
      return res.status(403).json({
        success: false,
        error: "Groupe privé"
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
      error: "Impossible de charger le groupe"
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

    const { error: joinError } = await supabase
      .from("novatalk_group_members")
      .upsert({
        group_id: group.id,
        user_id: req.user.id,
        role: "member"
      }, {
        onConflict: "group_id,user_id"
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
      error: "Impossible de rejoindre le groupe"
    });
  }
});


// Quitter un groupe
app.delete("/api/groups/:id/leave", auth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("novatalk_group_members")
      .delete()
      .eq("group_id", req.params.id)
      .eq("user_id", req.user.id)
      .select("id")
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({
        success: false,
        error: "Tu n'es pas membre de ce groupe"
      });
    }

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


// Membres d'un groupe
app.get("/api/groups/:id/members", auth, async (req, res) => {
  try {
    const { data: group, error: groupError } = await supabase
      .from("novatalk_groups")
      .select("id,privacy")
      .eq("id", req.params.id)
      .maybeSingle();

    if (groupError) throw groupError;

    if (!group) {
      return res.status(404).json({
        success: false,
        error: "Groupe introuvable"
      });
    }

    const { data: membership, error: memberError } = await supabase
      .from("novatalk_group_members")
      .select("id")
      .eq("group_id", group.id)
      .eq("user_id", req.user.id)
      .maybeSingle();

    if (memberError) throw memberError;

    if (group.privacy === "private" && !membership) {
      return res.status(403).json({
        success: false,
        error: "Accès réservé aux membres"
      });
    }

    const { data, error } = await supabase
      .from("novatalk_group_members")
      .select("id,user_id,role,joined_at")
      .eq("group_id", group.id)
      .order("joined_at", { ascending: true });

    if (error) throw error;

    res.json({
      success: true,
      members: data || []
    });

  } catch (error) {
    console.error("GROUP MEMBERS:", error);

    res.status(500).json({
      success: false,
      error: "Impossible de charger les membres"
    });
  }
});


// Ajouter un membre
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
        error: "Permission insuffisante"
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
      error: "Impossible d'ajouter le membre"
    });
  }
});


// Retirer un membre
app.delete(
  "/api/groups/:id/members/:userId",
  auth,
  async (req, res) => {
    try {
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

      const { data, error } = await supabase
        .from("novatalk_group_members")
        .delete()
        .eq("group_id", req.params.id)
        .eq("user_id", req.params.userId)
        .select("id")
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        return res.status(404).json({
          success: false,
          error: "Membre introuvable"
        });
      }

      res.json({
        success: true,
        message: "Membre retiré"
      });

    } catch (error) {
      console.error("GROUP REMOVE MEMBER:", error);

      res.status(500).json({
        success: false,
        error: "Impossible de retirer le membre"
      });
    }
  }
);


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


/* ================= DÉMARRAGE DU SERVEUR ================= */

app.listen(PORT, () => {
  console.log("--------------------------------------");
  console.log("NOVATALK V4 🌍");
  console.log("CONNECT THE WORLD");
  console.log("BY MARUCE SOLDADO 🇬🇳");
  console.log("PORT:", PORT);
  console.log("SUPABASE: CONFIGURED");
  console.log("SERVER: ONLINE");
  console.log("--------------------------------------");
});


/* ================= FIN DU SERVEUR ================= */
