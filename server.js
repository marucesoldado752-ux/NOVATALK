"use strict";

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
    console.error("NOVATALK: Configuration manquante.");
    process.exit(1);
}

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

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "20kb" }));

app.use("/api", rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 100,
    standardHeaders: true,
    legacyHeaders: false
}));

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    message: {
        success: false,
        message: "Trop de tentatives. Réessayez plus tard."
    }
});

function createToken(user) {
    return jwt.sign(
        {
            id: user.id,
            username: user.username
        },
        JWT_SECRET,
        {
            expiresIn: "7d",
            issuer: "NOVATALK"
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
            header.slice(7),
            JWT_SECRET,
            { issuer: "NOVATALK" }
        );

        next();

    } catch {
        return res.status(401).json({
            success: false,
            message: "Session invalide ou expirée."
        });
    }
}

// ACCUEIL

app.get("/", (req, res) => {
    res.json({
        name: "NOVATALK",
        slogan: "Connect the World 🌍",
        version: "1.0.0",
        status: "online"
    });
});

// ÉTAT DU SERVEUR

app.get("/health", (req, res) => {
    res.json({
        success: true,
        server: "online",
        application: "NOVATALK"
    });
});

// INSCRIPTION

app.post(
    "/api/auth/register",
    authLimiter,
    async (req, res) => {
        try {
            const { full_name, username, password } = req.body;

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
                    message: "Identifiant : 3 à 20 caractères, lettres, chiffres et _ uniquement."
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
                if (error.code === "23505") {
                    return res.status(409).json({
                        success: false,
                        message: "Cet identifiant est déjà utilisé."
                    });
                }

                console.error("Erreur inscription:", error);

                return res.status(500).json({
                    success: false,
                    message: "Impossible de créer le compte."
                });
            }

            const token = createToken(data);

            return res.status(201).json({
                success: true,
                message: "Bienvenue sur NOVATALK !",
                token,
                user: data
            });

        } catch (error) {
            console.error(error);

            return res.status(500).json({
                success: false,
                message: "Erreur interne du serveur."
            });
        }
    }
);

// CONNEXION

app.post(
    "/api/auth/login",
    authLimiter,
    async (req, res) => {
        try {
            const { username, password } = req.body;

            if (
                typeof username !== "string" ||
                typeof password !== "string" ||
                username.length > 20 ||
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
                .select("*")
                .eq("username", user)
                .maybeSingle();

            if (error) {
                throw error;
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
            console.error(error);

            return res.status(500).json({
                success: false,
                message: "Erreur interne du serveur."
            });
        }
    }
);

// PROFIL CONNECTÉ

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

        res.json({
            success: true,
            user: data
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: "Erreur serveur."
        });
    }
});

// ROUTE INCONNUE

app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: "Route introuvable."
    });
});

// DÉMARRAGE

app.listen(PORT, () => {
    console.log(
        `NOVATALK V1 démarré sur le port ${PORT} 🌍`
    );
});
