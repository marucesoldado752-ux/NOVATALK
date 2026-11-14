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

app.use((req, res) => {/* =====================================================
   NOVATALK V4.0.0 — SOCIAL NETWORK API
   BY MARUCE SOLDADO 🇬🇳
===================================================== */

function validText(value, min = 1, max = 2000) {
    return typeof value === "string" &&
        value.trim().length >= min &&
        value.trim().length <= max;
}

function validMediaUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === "https:" &&
            url.hostname.length > 0;
    } catch {
        return false;
    }
}

async function notifyUser(userId, actorId, type, message, referenceId = null, referenceType = null) {
    const { error } = await supabase
        .from("novatalk_notifications")
        .insert({
            user_id: userId,
            actor_id: actorId,
            notification_type: type,
            message,
            reference_id: referenceId,
            reference_type: referenceType
        });

    if (error) throw error;
}

async function getProfile(userId) {
    const { data, error } = await supabase
        .from("novatalk_profiles")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();

    if (error) throw error;

    return data;
}

/* =====================================================
   PROFIL UTILISATEUR
===================================================== */

app.get("/api/profile/:username", authenticate, async (req, res) => {
    try {
        const username = String(req.params.username || "")
            .trim().toLowerCase();

        const { data: user, error } = await supabase
            .from("novatalk_users")
            .select("id, full_name, username, created_at")
            .eq("username", username)
            .maybeSingle();

        if (error) throw error;

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "Profil introuvable."
            });
        }

        const profile = await getProfile(user.id);

        const { count: followers } = await supabase
            .from("novatalk_follows")
            .select("id", { count: "exact", head: true })
            .eq("following_id", user.id);

        const { count: following } = await supabase
            .from("novatalk_follows")
            .select("id", { count: "exact", head: true })
            .eq("follower_id", user.id);

        const { count: posts } = await supabase
            .from("novatalk_posts")
            .select("id", { count: "exact", head: true })
            .eq("author_id", user.id)
            .is("deleted_at", null);

        return res.json({
            success: true,
            user,
            profile: profile || {
                display_name: user.full_name,
                bio: "",
                avatar_url: null,
                cover_url: null,
                country: null
            },
            statistics: {
                followers: followers || 0,
                following: following || 0,
                posts: posts || 0
            }
        });

    } catch (error) {
        dbError("PROFIL V4", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de charger le profil."
        });
    }
});

/* Modifier son profil */

app.put("/api/profile", authenticate, async (req, res) => {
    try {
        const {
            display_name,
            bio,
            avatar_url,
            cover_url,
            country,
            website
        } = req.body || {};

        if (display_name !== undefined &&
            !validText(display_name, 2, 60)) {
            return res.status(400).json({
                success: false,
                message: "Nom invalide."
            });
        }

        if (bio !== undefined &&
            !validText(bio, 0, 500)) {
            return res.status(400).json({
                success: false,
                message: "Biographie trop longue."
            });
        }

        for (const url of [avatar_url, cover_url, website]) {
            if (url !== undefined && url !== null &&
                url !== "" && !validMediaUrl(url)) {
                return res.status(400).json({
                    success: false,
                    message: "Adresse HTTPS invalide."
                });
            }
        }

        const update = {
            updated_at: new Date().toISOString()
        };

        if (display_name !== undefined) update.display_name = display_name.trim();
        if (bio !== undefined) update.bio = bio.trim();
        if (avatar_url !== undefined) update.avatar_url = avatar_url || null;
        if (cover_url !== undefined) update.cover_url = cover_url || null;
        if (country !== undefined) update.country = String(country).slice(0, 80);
        if (website !== undefined) update.website = website || null;

        const { data, error } = await supabase
            .from("novatalk_profiles")
            .upsert({
                user_id: req.user.id,
                ...update
            }, {
                onConflict: "user_id"
            })
            .select()
            .single();

        if (error) throw error;

        return res.json({
            success: true,
            message: "Profil mis à jour.",
            profile: data
        });

    } catch (error) {
        dbError("MODIFICATION PROFIL", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de modifier le profil."
        });
    }
});

/* =====================================================
   ABONNEMENTS
===================================================== */

app.post("/api/follow/:userId", authenticate, async (req, res) => {
    try {
        const targetId = req.params.userId;

        if (!UUID.test(targetId) || targetId === req.user.id) {
            return res.status(400).json({
                success: false,
                message: "Utilisateur invalide."
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

        const { error } = await supabase
            .from("novatalk_follows")
            .upsert({
                follower_id: req.user.id,
                following_id: targetId
            }, {
                onConflict: "follower_id,following_id",
                ignoreDuplicates: true
            });

        if (error) throw error;

        await notifyUser(
            targetId,
            req.user.id,
            "new_follower",
            "Une personne vient de vous suivre.",
            req.user.id,
            "user"
        );

        return res.json({
            success: true,
            message: "Abonnement effectué."
        });

    } catch (error) {
        dbError("ABONNEMENT", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de suivre cet utilisateur."
        });
    }
});

app.delete("/api/follow/:userId", authenticate, async (req, res) => {
    try {
        const targetId = req.params.userId;

        const { error } = await supabase
            .from("novatalk_follows")
            .delete()
            .eq("follower_id", req.user.id)
            .eq("following_id", targetId);

        if (error) throw error;

        return res.json({
            success: true,
            message: "Désabonnement effectué."
        });

    } catch (error) {
        dbError("DÉSABONNEMENT", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de se désabonner."
        });
    }
});

app.get("/api/followers/:userId", authenticate, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("novatalk_follows")
            .select("follower_id, created_at")
            .eq("following_id", req.params.userId)
            .order("created_at", { ascending: false })
            .limit(100);

        if (error) throw error;

        const ids = (data || []).map(x => x.follower_id);

        const { data: users, error: usersError } = ids.length
            ? await supabase.from("novatalk_users")
                .select("id, full_name, username")
                .in("id", ids)
            : { data: [], error: null };

        if (usersError) throw usersError;

        return res.json({
            success: true,
            users: users || []
        });

    } catch (error) {
        dbError("ABONNÉS", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de charger les abonnés."
        });
    }
});

app.get("/api/following/:userId", authenticate, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("novatalk_follows")
            .select("following_id")
            .eq("follower_id", req.params.userId)
            .limit(100);

        if (error) throw error;

        const ids = (data || []).map(x => x.following_id);

        const { data: users, error: usersError } = ids.length
            ? await supabase.from("novatalk_users")
                .select("id, full_name, username")
                .in("id", ids)
            : { data: [], error: null };

        if (usersError) throw usersError;

        return res.json({
            success: true,
            users: users || []
        });

    } catch (error) {
        dbError("ABONNEMENTS", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de charger les abonnements."
        });
    }
});

/* =====================================================
   PUBLICATIONS ET FIL D'ACTUALITÉ
===================================================== */

app.post("/api/posts", authenticate, async (req, res) => {
    try {
        const {
            content = "",
            visibility = "public",
            media = [],
            post_type = "post",
            location = null
        } = req.body || {};

        if (!validText(content, 0, 5000) ||
            !["public", "friends", "followers", "private"].includes(visibility) ||
            !["post", "reel"].includes(post_type) ||
            !Array.isArray(media) ||
            media.length > 10) {
            return res.status(400).json({
                success: false,
                message: "Publication invalide."
            });
        }

        if (!content.trim() && media.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Ajoutez du texte ou un média."
            });
        }

        for (const item of media) {
            if (!item ||
                !validMediaUrl(item.url) ||
                !["image", "video"].includes(item.type)) {
                return res.status(400).json({
                    success: false,
                    message: "Média invalide."
                });
            }
        }

        const { data: post, error } = await supabase
            .from("novatalk_posts")
            .insert({
                author_id: req.user.id,
                content: content.trim(),
                visibility,
                post_type,
                location
            })
            .select()
            .single();

        if (error) throw error;

        if (media.length) {
            const records = media.map((item, index) => ({
                post_id: post.id,
                media_url: item.url,
                media_type: item.type,
                position: index
            }));

            const { error: mediaError } = await supabase
                .from("novatalk_post_media")
                .insert(records);

            if (mediaError) {
                await supabase
                    .from("novatalk_posts")
                    .delete()
                    .eq("id", post.id)
                    .eq("author_id", req.user.id);

                throw mediaError;
            }
        }

        return res.status(201).json({
            success: true,
            post
        });

    } catch (error) {
        dbError("CRÉATION PUBLICATION", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de publier."
        });
    }
});

app.get("/api/feed", authenticate, async (req, res) => {
    try {
        const limit = Math.min(
            Math.max(parseInt(req.query.limit, 10) || 20, 1),
            50
        );

        const { data, error } = await supabase
            .from("novatalk_posts")
            .select(`
                *,
                novatalk_post_media(*)
            `)
            .eq("visibility", "public")
            .is("deleted_at", null)
            .order("created_at", { ascending: false })
            .limit(limit);

        if (error) throw error;

        const posts = [];

        for (const post of data || []) {
            const { data: author, error: authorError } = await supabase
                .from("novatalk_users")
                .select("id, full_name, username")
                .eq("id", post.author_id)
                .maybeSingle();

            if (authorError) throw authorError;

            const { count: likes, error: likesError } = await supabase
                .from("novatalk_post_reactions")
                .select("id", { count: "exact", head: true })
                .eq("post_id", post.id);

            if (likesError) throw likesError;

            const { count: comments, error: commentsError } = await supabase
                .from("novatalk_post_comments")
                .select("id", { count: "exact", head: true })
                .eq("post_id", post.id)
                .is("deleted_at", null);

            if (commentsError) throw commentsError;

            const { data: myReaction, error: reactionError } = await supabase
                .from("novatalk_post_reactions")
                .select("reaction_type")
                .eq("post_id", post.id)
                .eq("user_id", req.user.id)
                .maybeSingle();

            if (reactionError) throw reactionError;

            posts.push({
                ...post,
                author,
                likes: likes || 0,
                comments: comments || 0,
                my_reaction: myReaction?.reaction_type || null
            });
        }

        return res.json({
            success: true,
            posts
        });

    } catch (error) {
        dbError("FIL ACTUALITÉ", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de charger les publications."
        });
    }
});

/* Publications d'un membre */

app.get("/api/posts/user/:userId", authenticate, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("novatalk_posts")
            .select("*, novatalk_post_media(*)")
            .eq("author_id", req.params.userId)
            .eq("visibility", "public")
            .is("deleted_at", null)
            .order("created_at", { ascending: false })
            .limit(50);

        if (error) throw error;

        return res.json({
            success: true,
            posts: data || []
        });

    } catch (error) {
        dbError("PUBLICATIONS MEMBRE", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de charger les publications."
        });
    }
});

/* Supprimer sa publication */

app.delete("/api/posts/:id", authenticate, async (req, res) => {
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
                message: "Publication introuvable."
            });
        }

        return res.json({
            success: true,
            message: "Publication supprimée."
        });

    } catch (error) {
        dbError("SUPPRESSION PUBLICATION", error);

        return res.status(500).json({
            success: false,
            message: "Suppression impossible."
        });
    }
});

/* =====================================================
   RÉACTIONS
===================================================== */

app.post("/api/posts/:id/reactions", authenticate, async (req, res) => {
    try {
        const type = req.body?.reaction_type || "like";

        if (!["like", "love", "haha", "wow", "sad", "angry"].includes(type)) {
            return res.status(400).json({
                success: false,
                message: "Réaction invalide."
            });
        }

        const { data: post, error: postError } = await supabase
            .from("novatalk_posts")
            .select("id, author_id")
            .eq("id", req.params.id)
            .is("deleted_at", null)
            .maybeSingle();

        if (postError) throw postError;

        if (!post) {
            return res.status(404).json({
                success: false,
                message: "Publication introuvable."
            });
        }

        const { data, error } = await supabase
            .from("novatalk_post_reactions")
            .upsert({
                post_id: post.id,
                user_id: req.user.id,
                reaction_type: type
            }, {
                onConflict: "post_id,user_id"
            })
            .select()
            .single();

        if (error) throw error;

        if (post.author_id !== req.user.id) {
            await notifyUser(
                post.author_id,
                req.user.id,
                "post_reaction",
                "Quelqu'un a réagi à votre publication.",
                post.id,
                "post"
            );
        }

        return res.json({
            success: true,
            reaction: data
        });

    } catch (error) {
        dbError("RÉACTION", error);

        return res.status(500).json({
            success: false,
            message: "Impossible d'ajouter la réaction."
        });
    }
});

app.delete("/api/posts/:id/reactions", authenticate, async (req, res) => {
    try {
        const { error } = await supabase
            .from("novatalk_post_reactions")
            .delete()
            .eq("post_id", req.params.id)
            .eq("user_id", req.user.id);

        if (error) throw error;

        return res.json({
            success: true,
            message: "Réaction retirée."
        });

    } catch (error) {
        dbError("RETRAIT RÉACTION", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de retirer la réaction."
        });
    }
});

/* =====================================================
   COMMENTAIRES
===================================================== */

app.get("/api/posts/:id/comments", authenticate, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("novatalk_post_comments")
            .select("*")
            .eq("post_id", req.params.id)
            .is("deleted_at", null)
            .order("created_at", { ascending: true })
            .limit(100);

        if (error) throw error;

        const comments = [];

        for (const comment of data || []) {
            const { data: author, error: authorError } = await supabase
                .from("novatalk_users")
                .select("id, full_name, username")
                .eq("id", comment.author_id)
                .maybeSingle();

            if (authorError) throw authorError;

            comments.push({
                ...comment,
                author
            });
        }

        return res.json({
            success: true,
            comments
        });

    } catch (error) {
        dbError("COMMENTAIRES", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de charger les commentaires."
        });
    }
});

app.post("/api/posts/:id/comments", authenticate, async (req, res) => {
    try {
        const content = req.body?.content;
        const parentId = req.body?.parent_id || null;

        if (!validText(content, 1, 1000)) {
            return res.status(400).json({
                success: false,
                message: "Commentaire invalide."
            });
        }

        const { data: post, error: postError } = await supabase
            .from("novatalk_posts")
            .select("id, author_id")
            .eq("id", req.params.id)
            .is("deleted_at", null)
            .maybeSingle();

        if (postError) throw postError;

        if (!post) {
            return res.status(404).json({
                success: false,
                message: "Publication introuvable."
            });
        }

        if (parentId) {
            const { data: parent, error: parentError } = await supabase
                .from("novatalk_post_comments")
                .select("id")
                .eq("id", parentId)
                .eq("post_id", post.id)
                .is("deleted_at", null)
                .maybeSingle();

            if (parentError) throw parentError;

            if (!parent) {
                return res.status(400).json({
                    success: false,
                    message: "Commentaire parent introuvable."
                });
            }
        }

        const { data, error } = await supabase
            .from("novatalk_post_comments")
            .insert({
                post_id: post.id,
                author_id: req.user.id,
                parent_id: parentId,
                content: content.trim()
            })
            .select()
            .single();

        if (error) throw error;

        if (post.author_id !== req.user.id) {
            await notifyUser(
                post.author_id,
                req.user.id,
                "post_comment",
                "Quelqu'un a commenté votre publication.",
                post.id,
                "post"
            );
        }

        return res.status(201).json({
            success: true,
            comment: data
        });

    } catch (error) {
        dbError("AJOUT COMMENTAIRE", error);

        return res.status(500).json({
            success: false,
            message: "Impossible d'ajouter le commentaire."
        });
    }
});

app.delete("/api/comments/:id", authenticate, async (req, res) => {
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
                message: "Commentaire introuvable."
            });
        }

        return res.json({
            success: true,
            message: "Commentaire supprimé."
        });

    } catch (error) {
        dbError("SUPPRESSION COMMENTAIRE", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de supprimer le commentaire."
        });
    }
});

/* =====================================================
   STORIES
===================================================== */

app.post("/api/stories", authenticate, async (req, res) => {
    try {
        const {
            media_url,
            media_type = "image",
            text_content = null,
            background_color = null,
            visibility = "public"
        } = req.body || {};

        if (!validMediaUrl(media_url) ||
            !["image", "video", "text"].includes(media_type) ||
            !["public", "friends", "followers"].includes(visibility) ||
            (text_content !== null && !validText(text_content, 0, 500))) {
            return res.status(400).json({
                success: false,
                message: "Story invalide."
            });
        }

        const { data, error } = await supabase
            .from("novatalk_stories")
            .insert({
                user_id: req.user.id,
                media_url,
                media_type,
                text_content,
                background_color,
                visibility
            })
            .select()
            .single();

        if (error) throw error;

        return res.status(201).json({
            success: true,
            story: data
        });

    } catch (error) {
        dbError("CRÉATION STORY", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de publier la story."
        });
    }
});

app.get("/api/stories", authenticate, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("novatalk_stories")
            .select("*")
            .eq("visibility", "public")
            .gt("expires_at", new Date().toISOString())
            .order("created_at", { ascending: false })
            .limit(100);

        if (error) throw error;

        const stories = [];

        for (const story of data || []) {
            const { data: author, error: authorError } = await supabase
                .from("novatalk_users")
                .select("id, full_name, username")
                .eq("id", story.user_id)
                .maybeSingle();

            if (authorError) throw authorError;

            const { data: viewed, error: viewedError } = await supabase
                .from("novatalk_story_views")
                .select("id")
                .eq("story_id", story.id)
                .eq("viewer_id", req.user.id)
                .maybeSingle();

            if (viewedError) throw viewedError;

            stories.push({
                ...story,
                author,
                viewed: Boolean(viewed)
            });
        }

        return res.json({
            success: true,
            stories
        });

    } catch (error) {
        dbError("LISTE STORIES", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de charger les stories."
        });
    }
});

app.post("/api/stories/:id/view", authenticate, async (req, res) => {
    try {
        const { data: story, error: storyError } = await supabase
            .from("novatalk_stories")
            .select("id, user_id")
            .eq("id", req.params.id)
            .gt("expires_at", new Date().toISOString())
            .maybeSingle();

        if (storyError) throw storyError;

        if (!story) {
            return res.status(404).json({
                success: false,
                message: "Story introuvable ou expirée."
            });
        }

        const { error } = await supabase
            .from("novatalk_story_views")
            .upsert({
                story_id: story.id,
                viewer_id: req.user.id
            }, {
                onConflict: "story_id,viewer_id",
                ignoreDuplicates: true
            });

        if (error) throw error;

        return res.json({
            success: true,
            message: "Vue enregistrée."
        });

    } catch (error) {
        dbError("VUE STORY", error);

        return res.status(500).json({
            success: false,
            message: "Impossible d'enregistrer la vue."
        });
    }
});

/* Supprimer sa story */

app.delete("/api/stories/:id", authenticate, async (req, res) => {
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
                message: "Story introuvable."
            });
        }

        return res.json({
            success: true,
            message: "Story supprimée."
        });

    } catch (error) {
        dbError("SUPPRESSION STORY", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de supprimer la story."
        });
    }
});

/* =====================================================
   NOTIFICATIONS
===================================================== */

app.get("/api/notifications", authenticate, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("novatalk_notifications")
            .select("*")
            .eq("user_id", req.user.id)
            .order("created_at", { ascending: false })
            .limit(50);

        if (error) throw error;

        return res.json({
            success: true,
            notifications: data || []
        });

    } catch (error) {
        dbError("NOTIFICATIONS", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de charger les notifications."
        });
    }
});

app.get("/api/notifications/unread-count", authenticate, async (req, res) => {
    try {
        const { count, error } = await supabase
            .from("novatalk_notifications")
            .select("id", { count: "exact", head: true })
            .eq("user_id", req.user.id)
            .eq("is_read", false);

        if (error) throw error;

        return res.json({
            success: true,
            unread_count: count || 0
        });

    } catch (error) {
        dbError("NOTIFICATIONS NON LUES", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de compter les notifications."
        });
    }
});

app.patch("/api/notifications/:id/read", authenticate, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("novatalk_notifications")
            .update({ is_read: true })
            .eq("id", req.params.id)
            .eq("user_id", req.user.id)
            .select("id")
            .maybeSingle();

        if (error) throw error;

        if (!data) {
            return res.status(404).json({
                success: false,
                message: "Notification introuvable."
            });
        }

        return res.json({
            success: true
        });

    } catch (error) {
        dbError("LECTURE NOTIFICATION", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de modifier la notification."
        });
    }
});

app.patch("/api/notifications/read-all", authenticate, async (req, res) => {
    try {
        const { error } = await supabase
            .from("novatalk_notifications")
            .update({ is_read: true })
            .eq("user_id", req.user.id)
            .eq("is_read", false);

        if (error) throw error;

        return res.json({
            success: true,
            message: "Notifications lues."
        });

    } catch (error) {
        dbError("TOUTES NOTIFICATIONS LUES", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de modifier les notifications."
        });
    }
});

/* =====================================================
   COLLECTIONS ET PUBLICATIONS ENREGISTRÉES
===================================================== */

app.post("/api/collections", authenticate, async (req, res) => {
    try {
        const name = req.body?.name;

        if (!validText(name, 1, 80)) {
            return res.status(400).json({
                success: false,
                message: "Nom de collection invalide."
            });
        }

        const { data, error } = await supabase
            .from("novatalk_collections")
            .insert({
                user_id: req.user.id,
                name: name.trim()
            })
            .select()
            .single();

        if (error) throw error;

        return res.status(201).json({
            success: true,
            collection: data
        });

    } catch (error) {
        dbError("CRÉATION COLLECTION", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de créer la collection."
        });
    }
});

app.get("/api/collections", authenticate, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("novatalk_collections")
            .select("*")
            .eq("user_id", req.user.id)
            .order("created_at", { ascending: false });

        if (error) throw error;

        return res.json({
            success: true,
            collections: data || []
        });

    } catch (error) {
        dbError("COLLECTIONS", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de charger les collections."
        });
    }
});

app.post("/api/posts/:id/save", authenticate, async (req, res) => {
    try {
        const collectionId = req.body?.collection_id || null;

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
                message: "Publication introuvable."
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
                return res.status(403).json({
                    success: false,
                    message: "Collection inaccessible."
                });
            }
        }

        const { error } = await supabase
            .from("novatalk_saved_posts")
            .upsert({
                user_id: req.user.id,
                post_id: post.id,
                collection_id: collectionId
            }, {
                onConflict: "user_id,post_id"
            });

        if (error) throw error;

        return res.json({
            success: true,
            message: "Publication enregistrée."
        });

    } catch (error) {
        dbError("ENREGISTREMENT PUBLICATION", error);

        return res.status(500).json({
            success: false,
            message: "Impossible d'enregistrer la publication."
        });
    }
});

app.get("/api/saved-posts", authenticate, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("novatalk_saved_posts")
            .select("*, post:novatalk_posts(*)")
            .eq("user_id", req.user.id)
            .order("created_at", { ascending: false })
            .limit(100);

        if (error) throw error;

        return res.json({
            success: true,
            saved_posts: data || []
        });

    } catch (error) {
        dbError("PUBLICATIONS ENREGISTRÉES", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de charger les publications enregistrées."
        });
    }
});

app.delete("/api/posts/:id/save", authenticate, async (req, res) => {
    try {
        const { error } = await supabase
            .from("novatalk_saved_posts")
            .delete()
            .eq("post_id", req.params.id)
            .eq("user_id", req.user.id);

        if (error) throw error;

        return res.json({
            success: true,
            message: "Publication retirée des enregistrements."
        });

    } catch (error) {
        dbError("RETRAIT PUBLICATION ENREGISTRÉE", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de retirer la publication."
        });
    }
});

/* =====================================================
   PARAMÈTRES UTILISATEUR
===================================================== */

app.get("/api/settings", authenticate, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("novatalk_user_settings")
            .select("*")
            .eq("user_id", req.user.id)
            .maybeSingle();

        if (error) throw error;

        return res.json({
            success: true,
            settings: data || {
                private_account: false,
                allow_messages: "everyone",
                allow_comments: "everyone",
                allow_tagging: "everyone",
                show_online_status: true,
                show_read_receipts: true,
                push_notifications: true,
                language: "fr",
                theme: "dark"
            }
        });

    } catch (error) {
        dbError("PARAMÈTRES", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de charger les paramètres."
        });
    }
});

app.put("/api/settings", authenticate, async (req, res) => {
    try {
        const allowed = [
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

        const input = req.body || {};
        const update = {};

        for (const key of Object.keys(input)) {
            if (!allowed.includes(key)) continue;

            if ([
                "private_account",
                "show_online_status",
                "show_read_receipts",
                "push_notifications"
            ].includes(key) && typeof input[key] !== "boolean") {
                return res.status(400).json({
                    success: false,
                    message: "Paramètre invalide : " + key
                });
            }

            if ([
                "allow_messages",
                "allow_comments",
                "allow_tagging"
            ].includes(key) &&
            !["everyone", "friends", "nobody"].includes(input[key])) {
                return res.status(400).json({
                    success: false,
                    message: "Paramètre invalide : " + key
                });
            }

            if (key === "theme" &&
                !["dark", "light", "system"].includes(input[key])) {
                return res.status(400).json({
                    success: false,
                    message: "Thème invalide."
                });
            }

            if (key === "language" &&
                !["fr", "en", "es", "ar", "pt"].includes(input[key])) {
                return res.status(400).json({
                    success: false,
                    message: "Langue invalide."
                });
            }

            update[key] = input[key];
        }

        if (!Object.keys(update).length) {
            return res.status(400).json({
                success: false,
                message: "Aucun paramètre valide."
            });
        }

        update.user_id = req.user.id;
        update.updated_at = new Date().toISOString();

        const { data, error } = await supabase
            .from("novatalk_user_settings")
            .upsert(update, {
                onConflict: "user_id"
            })
            .select()
            .single();

        if (error) throw error;

        return res.json({
            success: true,
            settings: data
        });

    } catch (error) {
        dbError("MODIFICATION PARAMÈTRES", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de modifier les paramètres."
        });
    }
});

/* =====================================================
   BLOQUER / DÉBLOQUER UN UTILISATEUR
===================================================== */

app.post("/api/blocks/:userId", authenticate, async (req, res) => {
    try {
        const targetId = req.params.userId;

        if (!UUID.test(targetId) || targetId === req.user.id) {
            return res.status(400).json({
                success: false,
                message: "Utilisateur invalide."
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

        const { error } = await supabase
            .from("novatalk_blocks")
            .upsert({
                blocker_id: req.user.id,
                blocked_id: targetId
            }, {
                onConflict: "blocker_id,blocked_id",
                ignoreDuplicates: true
            });

        if (error) throw error;

        await supabase
            .from("novatalk_follows")
            .delete()
            .or(
                `and(follower_id.eq.${req.user.id},following_id.eq.${targetId}),and(follower_id.eq.${targetId},following_id.eq.${req.user.id})`
            );

        return res.json({
            success: true,
            message: "Utilisateur bloqué."
        });

    } catch (error) {
        dbError("BLOCAGE", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de bloquer cet utilisateur."
        });
    }
});

app.delete("/api/blocks/:userId", authenticate, async (req, res) => {
    try {
        const { error } = await supabase
            .from("novatalk_blocks")
            .delete()
            .eq("blocker_id", req.user.id)
            .eq("blocked_id", req.params.userId);

        if (error) throw error;

        return res.json({
            success: true,
            message: "Utilisateur débloqué."
        });

    } catch (error) {
        dbError("DÉBLOCAGE", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de débloquer cet utilisateur."
        });
    }
});

/* =====================================================
   GROUPES ET COMMUNAUTÉS
===================================================== */

app.post("/api/groups", authenticate, async (req, res) => {
    try {
        const { name, description = "", privacy = "public" } = req.body || {};

        if (!validText(name, 2, 80) ||
            !validText(description, 0, 1000) ||
            !["public", "private"].includes(privacy)) {
            return res.status(400).json({
                success: false,
                message: "Informations du groupe invalides."
            });
        }

        const { data: group, error } = await supabase
            .from("novatalk_groups")
            .insert({
                creator_id: req.user.id,
                name: name.trim(),
                description: description.trim(),
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

        return res.status(201).json({
            success: true,
            group
        });

    } catch (error) {
        dbError("CRÉATION GROUPE", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de créer le groupe."
        });
    }
});

app.get("/api/groups", authenticate, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from("novatalk_groups")
            .select("*")
            .eq("privacy", "public")
            .order("created_at", { ascending: false })
            .limit(50);

        if (error) throw error;

        return res.json({
            success: true,
            groups: data || []
        });

    } catch (error) {
        dbError("GROUPES", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de charger les groupes."
        });
    }
});

app.post("/api/groups/:id/join", authenticate, async (req, res) => {
    try {
        const groupId = req.params.id;

        const { data: group, error: groupError } = await supabase
            .from("novatalk_groups")
            .select("id, privacy")
            .eq("id", groupId)
            .maybeSingle();

        if (groupError) throw groupError;

        if (!group) {
            return res.status(404).json({
                success: false,
                message: "Groupe introuvable."
            });
        }

        if (group.privacy === "private") {
            return res.status(403).json({
                success: false,
                message: "Ce groupe est privé."
            });
        }

        const { error } = await supabase
            .from("novatalk_group_members")
            .upsert({
                group_id: groupId,
                user_id: req.user.id,
                role: "member"
            }, {
                onConflict: "group_id,user_id",
                ignoreDuplicates: true
            });

        if (error) throw error;

        return res.json({
            success: true,
            message: "Vous avez rejoint le groupe."
        });

    } catch (error) {
        dbError("REJOINDRE GROUPE", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de rejoindre le groupe."
        });
    }
});

app.get("/api/groups/:id/members", authenticate, async (req, res) => {
    try {
        const groupId = req.params.id;

        const { data: membership, error: membershipError } = await supabase
            .from("novatalk_group_members")
            .select("id")
            .eq("group_id", groupId)
            .eq("user_id", req.user.id)
            .maybeSingle();

        if (membershipError) throw membershipError;

        const { data: group, error: groupError } = await supabase
            .from("novatalk_groups")
            .select("privacy")
            .eq("id", groupId)
            .maybeSingle();

        if (groupError) throw groupError;

        if (!group) {
            return res.status(404).json({
                success: false,
                message: "Groupe introuvable."
            });
        }

        if (group.privacy === "private" && !membership) {
            return res.status(403).json({
                success: false,
                message: "Groupe privé."
            });
        }

        const { data, error } = await supabase
            .from("novatalk_group_members")
            .select("user_id, role, joined_at")
            .eq("group_id", groupId)
            .order("joined_at", { ascending: true });

        if (error) throw error;

        const ids = (data || []).map(x => x.user_id);

        const { data: users, error: usersError } = ids.length
            ? await supabase.from("novatalk_users")
                .select("id, full_name, username")
                .in("id", ids)
            : { data: [], error: null };

        if (usersError) throw usersError;

        return res.json({
            success: true,
            members: (data || []).map(member => ({
                ...member,
                user: (users || []).find(user => user.id === member.user_id)
            }))
        });

    } catch (error) {
        dbError("MEMBRES GROUPE", error);

        return res.status(500).json({
            success: false,
            message: "Impossible de charger les membres."
        });
    }
});

/* =====================================================
   FIN DES ROUTES SOCIALES V4
===================================================== */
