"use strict";

/* =====================================================
   NOVATALK 🌍 V3.0.0
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

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const JWT_SECRET = process.env.JWT_SECRET;

if (!SUPABASE_URL || !SUPABASE_KEY || !JWT_SECRET) {
    console.error("NOVATALK : configuration manquante.");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
        persistSession: false,
        autoRefreshToken: false
    }
});

/* ================= MIDDLEWARE ================= */

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(helmet());

app.use(cors({
    origin: process.env.FRONTEND_URL || true
}));

app.use(express.json({ limit: "20kb" }));

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
    legacyHeaders: false
});

/* ================= ERREURS ================= */

function dbError(operation, error) {
    console.error("NOVATALK DATABASE ERROR");
    console.error("OPERATION:", operation);
    console.error("MESSAGE:", error.message);
    console.error("CODE:", error.code);
    console.error("DETAILS:", error.details);
}

/* ================= JWT ================= */

function createToken(user) {
    return jwt.sign({
        id: user.id,
        username: user.username
    }, JWT_SECRET, {
        expiresIn: "7d",
        issuer: "NOVATALK",
        audience: "NOVATALK_USERS"
    });
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
    } catch {
        return res.status(401).json({
            success: false,
            message: "Session expirée."
        });
    }
}

/* ================= OUTILS ================= */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

async function getConversationPartner(conversationId, userId) {
    const { data, error } = await supabase
        .from("novatalk_conversation_members")
        .select("user_id")
        .eq("conversation_id", conversationId);

    if (error) throw error;

    const partner = (data || []).find(
        member => member.user_id !== userId
    );

    if (!partner) return null;

    const { data: user, error: userError } = await supabase
        .from("novatalk_users")
        .select("id, full_name, username")
        .eq("id", partner.user_id)
        .maybeSingle();

    if (userError) throw userError;

    return user;
}

/* ================= ACCUEIL ================= */

app.get("/", (req, res) => {
    res.json({
        success: true,
        application: "NOVATALK",
        slogan: "CONNECT THE WORLD 🌍",
        creator: "MARUCE SOLDADO 🇬🇳",
        version: "3.0.0",
        status: "online"
    });
});

app.get("/health", (req, res) => {
    res.json({
        success: true,
        server: "online",
        database: "configured",
        version: "3.0.0"
    });
});

/* =====================================================
   AUTHENTIFICATION
===================================================== */

app.post("/api/auth/register", authLimiter, async (req, res) => {
    try {
        const { full_name, username, password } = req.body || {};

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
                message: "Mot de passe invalide."
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
            dbError("INSCRIPTION", error);

            return res.status(error.code === "23505" ? 409 : 500).json({
                success: false,
                message: error.code === "23505"
                    ? "Cet identifiant est déjà utilisé."
                    : "Impossible de créer le compte."
            });
        }

        return res.status(201).json({
            success: true,
            token: createToken(data),
            user: data
        });

    } catch (error) {
        dbError("INSCRIPTION", error);

        return res.status(500).json({
            success: false,
            message: "Erreur pendant l'inscription."
        });
    }
});

app.post("/api/auth/login", authLimiter, async (req, res) => {
    try {
        const { username, password } = req.body || {};

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

        if (error) throw error;

        if (!data || !(await bcrypt.compare(password, data.password_hash))) {
            return res.status(401).json({
                success: false,
                message: "Identifiant ou mot de passe incorrect."
            });
        }

        const safeUser = {
            id: data.id,
            full_name: data.full_name,
            username: data.username,
            created_at: data.created_at
        };

        return res.json({
            success: true,
            token: createToken(safeUser),
            user: safeUser
        });

    } catch (error) {
        dbError("CONNEXION", error);

        return res.status(500).json({
            success: false,
            message: "Erreur de connexion."
        });
    }
});

app.get("/api/auth/me", authenticate, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("novatalk_users")
            .select("id, full_name, username, created_at")
            .eq("id", req.user.id)
            .maybeSingle();

        if (error) throw error;

        if (!data) {
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
        dbError("PROFIL", error);

        return res.status(500).json({
            success: false,
            message: "Erreur serveur."
        });
    }
});

/* =====================================================
   DÉCOUVRIR LES MEMBRES
===================================================== */

app.get("/api/users", authenticate, async (req, res) => {
    try {
        const limit = Math.min(
            Math.max(parseInt(req.query.limit, 10) || 30, 1),
            50
        );

        const { data, error } = await supabase
            .from("novatalk_users")
            .select("id, full_name, username, created_at")
            .neq("id", req.user.id)
            .order("created_at", { ascending: false })
            .limit(limit);

        if (error) throw error;

        return res.json({
            success: true,
            users: data || []
        });

    } catch (error) {
        dbError("DÉCOUVERTE", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de charger les membres."
        });
    }
});

/* Recherche conservée pour compatibilité */

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

        if (error) throw error;

        return res.json({
            success: true,
            users: data || []
        });

    } catch (error) {
        dbError("RECHERCHE", error);

        return res.status(500).json({
            success: false,
            message: "Recherche impossible."
        });
    }
});

/* =====================================================
   INVITATIONS D'AMITIÉ
===================================================== */

/* Envoyer une invitation */

app.post("/api/friend-requests", authenticate, async (req, res) => {
    try {
        const targetId = req.body?.user_id;

        if (!UUID.test(String(targetId || ""))) {
            return res.status(400).json({
                success: false,
                message: "Utilisateur invalide."
            });
        }

        if (targetId === req.user.id) {
            return res.status(400).json({
                success: false,
                message: "Vous ne pouvez pas vous inviter vous-même."
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
                message: "Utilisateur introuvable."
            });
        }

        if (await areFriends(req.user.id, targetId)) {
            return res.status(409).json({
                success: false,
                message: "Vous êtes déjà amis."
            });
        }

        /* Une invitation inverse existe peut-être */

        const { data: reverse, error: reverseError } = await supabase
            .from("novatalk_friend_requests")
            .select("id, status")
            .eq("sender_id", targetId)
            .eq("receiver_id", req.user.id)
            .maybeSingle();

        if (reverseError) throw reverseError;

        if (reverse?.status === "pending") {
            return res.status(409).json({
                success: false,
                message: "Cette personne vous a déjà envoyé une invitation."
            });
        }

        const { data: existing, error: existingError } = await supabase
            .from("novatalk_friend_requests")
            .select("id, status")
            .eq("sender_id", req.user.id)
            .eq("receiver_id", targetId)
            .maybeSingle();

        if (existingError) throw existingError;

        let result;

        if (existing) {
            if (existing.status === "pending") {
                return res.status(409).json({
                    success: false,
                    message: "Invitation déjà envoyée."
                });
            }

            const { data, error } = await supabase
                .from("novatalk_friend_requests")
                .update({
                    status: "pending",
                    updated_at: new Date().toISOString()
                })
                .eq("id", existing.id)
                .select()
                .single();

            if (error) throw error;
            result = data;

        } else {
            const { data, error } = await supabase
                .from("novatalk_friend_requests")
                .insert({
                    sender_id: req.user.id,
                    receiver_id: targetId
                })
                .select()
                .single();

            if (error) throw error;
            result = data;
        }

        return res.status(201).json({
            success: true,
            message: "Invitation envoyée.",
            request: result
        });

    } catch (error) {
        dbError("ENVOI INVITATION", error);

        return res.status(500).json({
            success: false,
            message: "Impossible d'envoyer l'invitation."
        });
    }
});

/* Voir les invitations reçues */

app.get("/api/friend-requests", authenticate, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("novatalk_friend_requests")
            .select("id, sender_id, receiver_id, status, created_at")
            .eq("receiver_id", req.user.id)
            .eq("status", "pending")
            .order("created_at", { ascending: false });

        if (error) throw error;

        const requests = [];

        for (const request of data || []) {
            const { data: sender, error: senderError } = await supabase
                .from("novatalk_users")
                .select("id, full_name, username")
                .eq("id", request.sender_id)
                .maybeSingle();

            if (senderError) throw senderError;

            if (sender) {
                requests.push({
                    ...request,
                    sender
                });
            }
        }

        return res.json({
            success: true,
            requests
        });

    } catch (error) {
        dbError("LISTE INVITATIONS", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de charger les invitations."
        });
    }
});

/* Accepter ou refuser */

app.post("/api/friend-requests/:id/respond", authenticate, async (req, res) => {
    try {
        const requestId = req.params.id;
        const action = req.body?.action;

        if (!UUID.test(requestId) || !["accept", "reject"].includes(action)) {
            return res.status(400).json({
                success: false,
                message: "Demande invalide."
            });
        }

        const { data: request, error } = await supabase
            .from("novatalk_friend_requests")
            .select("*")
            .eq("id", requestId)
            .eq("receiver_id", req.user.id)
            .eq("status", "pending")
            .maybeSingle();

        if (error) throw error;

        if (!request) {
            return res.status(404).json({
                success: false,
                message: "Invitation introuvable ou déjà traitée."
            });
        }

        const newStatus = action === "accept" ? "accepted" : "rejected";

        const { error: updateError } = await supabase
            .from("novatalk_friend_requests")
            .update({
                status: newStatus,
                updated_at: new Date().toISOString()
            })
            .eq("id", requestId)
            .eq("receiver_id", req.user.id);

        if (updateError) throw updateError;

        if (action === "accept") {
            const friendships = [
                {
                    user_id: req.user.id,
                    friend_id: request.sender_id
                },
                {
                    user_id: request.sender_id,
                    friend_id: req.user.id
                }
            ];

            const { error: friendError } = await supabase
                .from("novatalk_friends")
                .upsert(friendships, {
                    onConflict: "user_id,friend_id",
                    ignoreDuplicates: true
                });

            if (friendError) throw friendError;
        }

        return res.json({
            success: true,
            message: action === "accept"
                ? "Invitation acceptée."
                : "Invitation refusée."
        });

    } catch (error) {
        dbError("RÉPONSE INVITATION", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de traiter l'invitation."
        });
    }
});

/* =====================================================
   LISTE DES AMIS
===================================================== */

app.get("/api/friends", authenticate, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("novatalk_friends")
            .select("friend_id, created_at")
            .eq("user_id", req.user.id)
            .order("created_at", { ascending: false });

        if (error) throw error;

        const friends = [];

        for (const item of data || []) {
            const { data: friend, error: friendError } = await supabase
                .from("novatalk_users")
                .select("id, full_name, username, created_at")
                .eq("id", item.friend_id)
                .maybeSingle();

            if (friendError) throw friendError;

            if (friend) friends.push(friend);
        }

        return res.json({
            success: true,
            friends
        });

    } catch (error) {
        dbError("LISTE AMIS", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de charger les amis."
        });
    }
});

/* =====================================================
   CRÉER OU RETROUVER UNE CONVERSATION
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

        const { data: target, error } = await supabase
            .from("novatalk_users")
            .select("id, full_name, username")
            .eq("username", username)
            .maybeSingle();

        if (error) throw error;

        if (!target) {
            return res.status(404).json({
                success: false,
                message: "Utilisateur introuvable."
            });
        }

        if (target.id === req.user.id) {
            return res.status(400).json({
                success: false,
                message: "Conversation impossible."
            });
        }

        const { data: mine, error: mineError } = await supabase
            .from("novatalk_conversation_members")
            .select("conversation_id")
            .eq("user_id", req.user.id);

        if (mineError) throw mineError;

        const ids = (mine || []).map(item => item.conversation_id);

        if (ids.length) {
            const { data: shared, error: sharedError } = await supabase
                .from("novatalk_conversation_members")
                .select("conversation_id")
                .eq("user_id", target.id)
                .in("conversation_id", ids)
                .limit(1);

            if (sharedError) throw sharedError;

            if (shared?.length) {
                return res.json({
                    success: true,
                    existing: true,
                    conversation_id: shared[0].conversation_id,
                    user: target
                });
            }
        }

        if (!(await areFriends(req.user.id, target.id))) {
            return res.status(403).json({
                success: false,
                message: "Vous devez être amis pour commencer une nouvelle discussion."
            });
        }

        const { data: conversation, error: conversationError } = await supabase
            .from("novatalk_conversations")
            .insert({})
            .select("id")
            .single();

        if (conversationError) throw conversationError;

        const { error: memberError } = await supabase
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

        if (memberError) {
            await supabase
                .from("novatalk_conversations")
                .delete()
                .eq("id", conversation.id);

            throw memberError;
        }

        return res.status(201).json({
            success: true,
            existing: false,
            conversation_id: conversation.id,
            user: target
        });

    } catch (error) {
        dbError("CRÉATION CONVERSATION", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de créer la conversation."
        });
    }
});

/* =====================================================
   LISTE DES CONVERSATIONS + NON LUS
===================================================== */

app.get("/api/conversations", authenticate, async (req, res) => {
    try {
        const { data: memberships, error } = await supabase
            .from("novatalk_conversation_members")
            .select("conversation_id")
            .eq("user_id", req.user.id);

        if (error) throw error;

        const results = [];

        for (const membership of memberships || []) {
            const conversationId = membership.conversation_id;

            const partner = await getConversationPartner(
                conversationId,
                req.user.id
            );

            if (!partner) continue;

            const { data: lastMessages, error: messageError } = await supabase
                .from("novatalk_messages")
                .select("id, content, sender_id, created_at, is_read, edited_at, deleted_at")
                .eq("conversation_id", conversationId)
                .order("created_at", { ascending: false })
                .limit(1);

            if (messageError) throw messageError;

            const { count, error: unreadError } = await supabase
                .from("novatalk_messages")
                .select("id", { count: "exact", head: true })
                .eq("conversation_id", conversationId)
                .neq("sender_id", req.user.id)
                .eq("is_read", false);

            if (unreadError) throw unreadError;

            results.push({
                conversation_id: conversationId,
                user: partner,
                last_message: lastMessages?.[0] || null,
                unread_count: count || 0
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
        dbError("CONVERSATIONS", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de charger les conversations."
        });
    }
});

/* =====================================================
   HISTORIQUE DES MESSAGES
===================================================== */

app.get("/api/conversations/:id/messages", authenticate, async (req, res) => {
    try {
        const conversationId = req.params.id;

        if (!UUID.test(conversationId)) {
            return res.status(400).json({
                success: false,
                message: "Conversation invalide."
            });
        }

        if (!(await isConversationMember(conversationId, req.user.id))) {
            return res.status(403).json({
                success: false,
                message: "Accès interdit."
            });
        }

        const requestedLimit = parseInt(req.query.limit, 10) || 50;
        const limit = Math.min(Math.max(requestedLimit, 1), 100);
        const before = req.query.before;

        let query = supabase
            .from("novatalk_messages")
            .select("id, conversation_id, sender_id, content, created_at, is_read, edited_at, deleted_at, reply_to")
            .eq("conversation_id", conversationId)
            .order("created_at", { ascending: false })
            .limit(limit);

        if (before && !Number.isNaN(Date.parse(before))) {
            query = query.lt("created_at", before);
        }

        const { data, error } = await query;

        if (error) throw error;

        /* Marquer les messages reçus comme lus */

        const { error: readError } = await supabase
            .from("novatalk_messages")
            .update({ is_read: true })
            .eq("conversation_id", conversationId)
            .neq("sender_id", req.user.id)
            .eq("is_read", false);

        if (readError) throw readError;

        /* Récupération après mise à jour */

        const messages = (data || []).reverse().map(message => ({
            ...message,
            is_read: message.sender_id === req.user.id
                ? message.is_read
                : true
        }));

        return res.json({
            success: true,
            messages,
            has_more: messages.length === limit
        });

    } catch (error) {
        dbError("HISTORIQUE", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de charger les messages."
        });
    }
});

/* =====================================================
   ENVOYER UN MESSAGE
===================================================== */

app.post("/api/conversations/:id/messages", authenticate, async (req, res) => {
    try {
        const conversationId = req.params.id;
        const content = req.body?.content;
        const replyTo = req.body?.reply_to || null;

        if (!UUID.test(conversationId)) {
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
                message: "Message invalide."
            });
        }

        if (!(await isConversationMember(conversationId, req.user.id))) {
            return res.status(403).json({
                success: false,
                message: "Accès interdit."
            });
        }

        if (replyTo !== null) {
            if (!UUID.test(String(replyTo))) {
                return res.status(400).json({
                    success: false,
                    message: "Réponse invalide."
                });
            }

            const { data: original, error: originalError } = await supabase
                .from("novatalk_messages")
                .select("id")
                .eq("id", replyTo)
                .eq("conversation_id", conversationId)
                .maybeSingle();

            if (originalError) throw originalError;

            if (!original) {
                return res.status(404).json({
                    success: false,
                    message: "Message d'origine introuvable."
                });
            }
        }

        const { data, error } = await supabase
            .from("novatalk_messages")
            .insert({
                conversation_id: conversationId,
                sender_id: req.user.id,
                content: content.trim(),
                reply_to: replyTo
            })
            .select("id, conversation_id, sender_id, content, created_at, is_read, edited_at, deleted_at, reply_to")
            .single();

        if (error) throw error;

        await supabase
            .from("novatalk_conversations")
            .update({
                updated_at: new Date().toISOString()
            })
            .eq("id", conversationId);

        return res.status(201).json({
            success: true,
            data
        });

    } catch (error) {
        dbError("ENVOI MESSAGE", error);

        return res.status(500).json({
            success: false,
            message: "Impossible d'envoyer le message."
        });
    }
});

/* =====================================================
   MODIFIER UN MESSAGE
===================================================== */

app.patch("/api/messages/:id", authenticate, async (req, res) => {
    try {
        const messageId = req.params.id;
        const content = req.body?.content;

        if (!UUID.test(messageId)) {
            return res.status(400).json({
                success: false,
                message: "Message invalide."
            });
        }

        if (
            typeof content !== "string" ||
            !content.trim() ||
            content.trim().length > 4000
        ) {
            return res.status(400).json({
                success: false,
                message: "Contenu invalide."
            });
        }

        const { data: message, error } = await supabase
            .from("novatalk_messages")
            .select("id, sender_id, conversation_id, deleted_at")
            .eq("id", messageId)
            .maybeSingle();

        if (error) throw error;

        if (!message || message.sender_id !== req.user.id || message.deleted_at) {
            return res.status(404).json({
                success: false,
                message: "Message introuvable ou modification interdite."
            });
        }

        const { data, error: updateError } = await supabase
            .from("novatalk_messages")
            .update({
                content: content.trim(),
                edited_at: new Date().toISOString()
            })
            .eq("id", messageId)
            .eq("sender_id", req.user.id)
            .select()
            .single();

        if (updateError) throw updateError;

        return res.json({
            success: true,
            message: "Message modifié.",
            data
        });

    } catch (error) {
        dbError("MODIFICATION MESSAGE", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de modifier le message."
        });
    }
});

/* =====================================================
   SUPPRIMER UN MESSAGE
===================================================== */

app.delete("/api/messages/:id", authenticate, async (req, res) => {
    try {
        const messageId = req.params.id;

        if (!UUID.test(messageId)) {
            return res.status(400).json({
                success: false,
                message: "Message invalide."
            });
        }

        const { data: message, error } = await supabase
            .from("novatalk_messages")
            .select("id, sender_id, deleted_at")
            .eq("id", messageId)
            .maybeSingle();

        if (error) throw error;

        if (!message || message.sender_id !== req.user.id) {
            return res.status(404).json({
                success: false,
                message: "Message introuvable ou suppression interdite."
            });
        }

        if (!message.deleted_at) {
            const { error: deleteError } = await supabase
                .from("novatalk_messages")
                .update({
                    content: "Ce message a été supprimé.",
                    deleted_at: new Date().toISOString()
                })
                .eq("id", messageId)
                .eq("sender_id", req.user.id);

            if (deleteError) throw deleteError;
        }

        return res.json({
            success: true,
            message: "Message supprimé."
        });

    } catch (error) {
        dbError("SUPPRESSION MESSAGE", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de supprimer le message."
        });
    }
});

/* =====================================================
   DÉCONNEXION
===================================================== */

app.post("/api/auth/logout", authenticate, (req, res) => {
    return res.json({
        success: true,
        message: "Déconnexion effectuée."
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

    if (res.headersSent) return next(error);

    res.status(500).json({
        success: false,
        message: "Erreur serveur."
    });
});

/* ================= DÉMARRAGE ================= */

app.listen(PORT, () => {
    console.log("--------------------------------");
    console.log("NOVATALK 🌍");
    console.log("CONNECT THE WORLD");
    console.log("BY MARUCE SOLDADO 🇬🇳");
    console.log("VERSION: 3.0.0");
    console.log("SERVER: ONLINE");
    console.log("PORT:", PORT);
    console.log("--------------------------------");
});
