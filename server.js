"use strict";

/* =====================================================
   NOVATALK 🌍 V2.0.0
   CONNECT THE WORLD
   BY MARUCE SOLDADO 🇬🇳
===================================================== */

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = process.env.PORT || 3000;

/* ================= CONFIGURATION ================= */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const JWT_SECRET = process.env.JWT_SECRET;

console.log("NOVATALK CONFIGURATION:", {
    SUPABASE_URL: Boolean(SUPABASE_URL),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(SUPABASE_KEY),
    JWT_SECRET: Boolean(JWT_SECRET)
});

if (!SUPABASE_URL || !SUPABASE_KEY || !JWT_SECRET) {
    console.error("NOVATALK : configuration manquante.");
    process.exit(1);
}

/* ================= SUPABASE ================= */

const supabase = createClient(
    SUPABASE_URL,
    SUPABASE_KEY,
    {
        auth: {
            persistSession: false,
            autoRefreshToken: false
        }
    }
);

/* ================= MIDDLEWARE ================= */

app.disable("x-powered-by");

/* Render utilise un proxy */
app.set("trust proxy", 1);

app.use(helmet());

app.use(cors({
    origin: process.env.FRONTEND_URL || true
}));

app.use(express.json({
    limit: "20kb"
}));

app.use("/api", rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 200,
    standardHeaders: true,
    legacyHeaders: false
}));

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: "Trop de tentatives. Réessayez plus tard."
    }
});

/* ================= DIAGNOSTIC ================= */

function logDatabaseError(operation, error) {
    console.error("=================================");
    console.error("NOVATALK - ERREUR SUPABASE");
    console.error("OPERATION:", operation);
    console.error("MESSAGE:", error.message);
    console.error("CODE:", error.code);
    console.error("DETAILS:", error.details);
    console.error("HINT:", error.hint);
    console.error("=================================");
}

/* ================= JWT ================= */

function createToken(user) {
    return jwt.sign(
        {
            id: user.id,
            username: user.username
        },
        JWT_SECRET,
        {
            expiresIn: "7d",
            issuer: "NOVATALK",
            audience: "NOVATALK_USERS"
        }
    );
}

function authenticate(req, res, next) {
    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
        return res.status(401).json({
            success: false,
            message: "Connexion requise."
        });
    }

    try {
        req.user = jwt.verify(
            header.substring(7),
            JWT_SECRET,
            {
                issuer: "NOVATALK",
                audience: "NOVATALK_USERS"
            }
        );

        next();

    } catch (error) {
        return res.status(401).json({
            success: false,
            message: "Session invalide ou expirée."
        });
    }
}

/* ================= OUTILS ================= */

async function isConversationMember(conversationId, userId) {
    const { data, error } = await supabase
        .from("novatalk_conversation_members")
        .select("id")
        .eq("conversation_id", conversationId)
        .eq("user_id", userId)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return Boolean(data);
}

/* ================= ACCUEIL ================= */

app.get("/", (req, res) => {
    res.json({
        success: true,
        application: "NOVATALK",
        slogan: "Connect the World 🌍",
        creator: "MARUCE SOLDADO 🇬🇳",
        version: "2.0.0",
        status: "online"
    });
});

/* ================= HEALTH ================= */

app.get("/health", (req, res) => {
    res.json({
        success: true,
        application: "NOVATALK",
        server: "online",
        database: "configured",
        version: "2.0.0"
    });
});

/* =====================================================
   AUTHENTIFICATION
===================================================== */

/* ================= INSCRIPTION ================= */

app.post("/api/auth/register", authLimiter, async (req, res) => {
    try {
        const {
            full_name,
            username,
            password
        } = req.body || {};

        if (
            typeof full_name !== "string" ||
            typeof username !== "string" ||
            typeof password !== "string"
        ) {
            return res.status(400).json({
                success: false,
                message: "Informations invalides."
            });
        }

        const name = full_name.trim();
        const user = username.trim().toLowerCase();

        if (name.length < 2 || name.length > 60) {
            return res.status(400).json({
                success: false,
                message: "Nom invalide."
            });
        }

        if (!/^[a-z0-9_]{3,20}$/.test(user)) {
            return res.status(400).json({
                success: false,
                message: "Identifiant invalide."
            });
        }

        if (password.length < 8 || password.length > 72) {
            return res.status(400).json({
                success: false,
                message: "Le mot de passe doit contenir entre 8 et 72 caractères."
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const { data, error } = await supabase
            .from("novatalk_users")
            .insert({
                full_name: name,
                username: user,
                password_hash: passwordHash
            })
            .select("id, full_name, username, created_at")
            .single();

        if (error) {
            logDatabaseError("INSCRIPTION", error);

            if (error.code === "23505") {
                return res.status(409).json({
                    success: false,
                    message: "Cet identifiant est déjà utilisé."
                });
            }

            return res.status(500).json({
                success: false,
                message: "Impossible de créer le compte."
            });
        }

        const token = createToken(data);

        console.log("NOUVEAU COMPTE:", data.username);

        return res.status(201).json({
            success: true,
            message: "Bienvenue sur NOVATALK !",
            token,
            user: data
        });

    } catch (error) {
        console.error("INSCRIPTION:", error.message);

        return res.status(500).json({
            success: false,
            message: "Erreur interne pendant l'inscription."
        });
    }
});

/* ================= CONNEXION ================= */

app.post("/api/auth/login", authLimiter, async (req, res) => {
    try {
        const {
            username,
            password
        } = req.body || {};

        if (
            typeof username !== "string" ||
            typeof password !== "string" ||
            username.length > 20 ||
            password.length < 1 ||
            password.length > 72
        ) {
            return res.status(400).json({
                success: false,
                message: "Identifiants invalides."
            });
        }

        const user = username.trim().toLowerCase();

        const { data, error } = await supabase
            .from("novatalk_users")
            .select("id, full_name, username, password_hash, created_at")
            .eq("username", user)
            .maybeSingle();

        if (error) {
            logDatabaseError("CONNEXION", error);

            return res.status(500).json({
                success: false,
                message: "Impossible de vérifier le compte."
            });
        }

        if (
            !data ||
            !(await bcrypt.compare(password, data.password_hash))
        ) {
            return res.status(401).json({
                success: false,
                message: "Identifiant ou mot de passe incorrect."
            });
        }

        const token = createToken(data);

        console.log("CONNEXION:", data.username);

        return res.json({
            success: true,
            message: "Connexion réussie.",
            token,
            user: {
                id: data.id,
                full_name: data.full_name,
                username: data.username,
                created_at: data.created_at
            }
        });

    } catch (error) {
        console.error("CONNEXION:", error.message);

        return res.status(500).json({
            success: false,
            message: "Erreur interne pendant la connexion."
        });
    }
});

/* ================= MON PROFIL ================= */

app.get("/api/auth/me", authenticate, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("novatalk_users")
            .select("id, full_name, username, created_at")
            .eq("id", req.user.id)
            .single();

        if (error || !data) {
            return res.status(404).json({
                success: false,
                message: "Utilisateur introuvable."
            });
        }

        return res.json({
            success: true,
            user: data
        });

    } catch (error) {
        console.error("PROFIL:", error.message);

        return res.status(500).json({
            success: false,
            message: "Erreur serveur."
        });
    }
});

/* =====================================================
   RECHERCHE DES UTILISATEURS
===================================================== */

app.get("/api/users/search", authenticate, async (req, res) => {
    try {
        const query = String(req.query.q || "")
            .trim()
            .toLowerCase();

        if (query.length < 3 || query.length > 20) {
            return res.status(400).json({
                success: false,
                message: "Saisissez au moins 3 caractères."
            });
        }

        if (!/^[a-z0-9_]+$/.test(query)) {
            return res.status(400).json({
                success: false,
                message: "Identifiant invalide."
            });
        }

        const { data, error } = await supabase
            .from("novatalk_users")
            .select("id, full_name, username, created_at")
            .ilike("username", `%${query}%`)
            .neq("id", req.user.id)
            .limit(20);

        if (error) {
            logDatabaseError("RECHERCHE UTILISATEURS", error);

            return res.status(500).json({
                success: false,
                message: "Recherche impossible."
            });
        }

        return res.json({
            success: true,
            users: data || []
        });

    } catch (error) {
        console.error("RECHERCHE:", error.message);

        return res.status(500).json({
            success: false,
            message: "Erreur serveur."
        });
    }
});

/* =====================================================
   CRÉER OU RETROUVER UNE CONVERSATION PRIVÉE
===================================================== */

app.post("/api/conversations", authenticate, async (req, res) => {
    try {
        const username = String(req.body?.username || "")
            .trim()
            .toLowerCase();

        if (!/^[a-z0-9_]{3,20}$/.test(username)) {
            return res.status(400).json({
                success: false,
                message: "Identifiant invalide."
            });
        }

        const { data: target, error: targetError } = await supabase
            .from("novatalk_users")
            .select("id, full_name, username")
            .eq("username", username)
            .maybeSingle();

        if (targetError) {
            logDatabaseError("RECHERCHE DESTINATAIRE", targetError);

            return res.status(500).json({
                success: false,
                message: "Impossible de trouver cet utilisateur."
            });
        }

        if (!target) {
            return res.status(404).json({
                success: false,
                message: "Utilisateur introuvable."
            });
        }

        if (target.id === req.user.id) {
            return res.status(400).json({
                success: false,
                message: "Vous ne pouvez pas discuter avec vous-même."
            });
        }

        /* Chercher une conversation déjà existante */

        const { data: mine, error: mineError } = await supabase
            .from("novatalk_conversation_members")
            .select("conversation_id")
            .eq("user_id", req.user.id);

        if (mineError) throw mineError;

        const myConversationIds = (mine || [])
            .map(item => item.conversation_id);

        if (myConversationIds.length) {
            const { data: shared, error: sharedError } = await supabase
                .from("novatalk_conversation_members")
                .select("conversation_id")
                .eq("user_id", target.id)
                .in("conversation_id", myConversationIds)
                .limit(1);

            if (sharedError) throw sharedError;

            if (shared && shared.length) {
                return res.json({
                    success: true,
                    existing: true,
                    conversation_id: shared[0].conversation_id,
                    user: target
                });
            }
        }

        /* Créer une nouvelle conversation */

        const { data: conversation, error: conversationError } =
            await supabase
                .from("novatalk_conversations")
                .insert({})
                .select("id")
                .single();

        if (conversationError) throw conversationError;

        const { error: membersError } = await supabase
            .from("novatalk_conversation_members")
            .insert([
                {
                    conversation_id: conversation.id,
                    user_id: req.user.id
                },
                {
                    conversation_id: conversation.id,
                    user_id: target.id
                }
            ]);

        if (membersError) {
            await supabase
                .from("novatalk_conversations")
                .delete()
                .eq("id", conversation.id);

            throw membersError;
        }

        console.log(
            "NOUVELLE CONVERSATION:",
            req.user.username,
            target.username
        );

        return res.status(201).json({
            success: true,
            existing: false,
            conversation_id: conversation.id,
            user: target
        });

    } catch (error) {
        logDatabaseError("CRÉATION CONVERSATION", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de créer la conversation."
        });
    }
});

/* =====================================================
   LISTE DES CONVERSATIONS
===================================================== */

app.get("/api/conversations", authenticate, async (req, res) => {
    try {
        const { data: memberships, error } = await supabase
            .from("novatalk_conversation_members")
            .select("conversation_id")
            .eq("user_id", req.user.id);

        if (error) throw error;

        const results = [];

        for (const membership of (memberships || [])) {
            const conversationId = membership.conversation_id;

            const { data: members, error: membersError } = await supabase
                .from("novatalk_conversation_members")
                .select("user_id")
                .eq("conversation_id", conversationId);

            if (membersError) throw membersError;

            const otherMember = (members || []).find(
                member => member.user_id !== req.user.id
            );

            if (!otherMember) continue;

            const { data: otherUser, error: userError } = await supabase
                .from("novatalk_users")
                .select("id, full_name, username")
                .eq("id", otherMember.user_id)
                .maybeSingle();

            if (userError) throw userError;
            if (!otherUser) continue;

            const { data: lastMessages, error: messageError } = await supabase
                .from("novatalk_messages")
                .select("id, content, sender_id, created_at")
                .eq("conversation_id", conversationId)
                .order("created_at", { ascending: false })
                .limit(1);

            if (messageError) throw messageError;

            results.push({
                conversation_id: conversationId,
                user: otherUser,
                last_message: lastMessages?.[0] || null
            });
        }

        results.sort((a, b) => {
            const dateA = a.last_message?.created_at || "";
            const dateB = b.last_message?.created_at || "";
            return dateB.localeCompare(dateA);
        });

        return res.json({
            success: true,
            conversations: results
        });

    } catch (error) {
        logDatabaseError("LISTE CONVERSATIONS", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de charger les conversations."
        });
    }
});

/* =====================================================
   RÉCUPÉRER LES MESSAGES
===================================================== */

app.get(
    "/api/conversations/:id/messages",
    authenticate,
    async (req, res) => {
        try {
            const conversationId = req.params.id;

            if (
                !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationId)
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Identifiant de conversation invalide."
                });
            }

            const allowed = await isConversationMember(
                conversationId,
                req.user.id
            );

            if (!allowed) {
                return res.status(403).json({
                    success: false,
                    message: "Accès interdit à cette conversation."
                });
            }

            const { data, error } = await supabase
                .from("novatalk_messages")
                .select("id, conversation_id, sender_id, content, created_at, is_read")
                .eq("conversation_id", conversationId)
                .order("created_at", { ascending: true })
                .limit(100);

            if (error) throw error;

            /* Marquer comme lus les messages reçus */

            const { error: readError } = await supabase
                .from("novatalk_messages")
                .update({ is_read: true })
                .eq("conversation_id", conversationId)
                .neq("sender_id", req.user.id)
                .eq("is_read", false);

            if (readError) throw readError;

            return res.json({
                success: true,
                messages: data || []
            });

        } catch (error) {
            logDatabaseError("RÉCUPÉRATION MESSAGES", error);

            return res.status(500).json({
                success: false,
                message: "Impossible de charger les messages."
            });
        }
    }
);

/* =====================================================
   ENVOYER UN MESSAGE
===================================================== */

app.post(
    "/api/conversations/:id/messages",
    authenticate,
    async (req, res) => {
        try {
            const conversationId = req.params.id;
            const content = req.body?.content;

            if (
                !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationId)
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Conversation invalide."
                });
            }

            if (
                typeof content !== "string" ||
                !content.trim() ||
                content.trim().length > 4000
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Le message doit contenir entre 1 et 4000 caractères."
                });
            }

            const allowed = await isConversationMember(
                conversationId,
                req.user.id
            );

            if (!allowed) {
                return res.status(403).json({
                    success: false,
                    message: "Vous ne pouvez pas écrire dans cette conversation."
                });
            }

            const { data, error } = await supabase
                .from("novatalk_messages")
                .insert({
                    conversation_id: conversationId,
                    sender_id: req.user.id,
                    content: content.trim()
                })
                .select("id, conversation_id, sender_id, content, created_at, is_read")
                .single();

            if (error) throw error;

            await supabase
                .from("novatalk_conversations")
                .update({
                    updated_at: new Date().toISOString()
                })
                .eq("id", conversationId);

            console.log(
                "MESSAGE ENVOYÉ PAR:",
                req.user.username
            );

            return res.status(201).json({
                success: true,
                message: "Message envoyé.",
                data
            });

        } catch (error) {
            logDatabaseError("ENVOI MESSAGE", error);

            return res.status(500).json({
                success: false,
                message: "Impossible d'envoyer le message."
            });
        }
    }
);

/* =====================================================
   DÉCONNEXION
===================================================== */

app.post("/api/auth/logout", authenticate, (req, res) => {
    return res.json({
        success: true,
        message: "Déconnexion effectuée. Supprimez le jeton côté client."
    });
});

/* ================= ROUTES INCONNUES ================= */

app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: "Route introuvable."
    });
});

/* ================= ERREURS ================= */

app.use((error, req, res, next) => {
    console.error("ERREUR SERVEUR:", error.message);

    if (res.headersSent) {
        return next(error);
    }

    res.status(500).json({
        success: false,
        message: "Une erreur est survenue."
    });
});

/* ================= DÉMARRAGE ================= */

app.listen(PORT, () => {
    console.log("--------------------------------");
    console.log("NOVATALK 🌍");
    console.log("CONNECT THE WORLD");
    console.log("BY MARUCE SOLDADO 🇬🇳");
    console.log("--------------------------------");
    console.log("VERSION: 2.0.0");
    console.log("SERVER: ONLINE");
    console.log("PORT:", PORT);
    console.log("--------------------------------");
});
