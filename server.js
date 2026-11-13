"use strict";

/* =========================================
   NOVATALK 🌍 V1.0.1
   CONNECT THE WORLD
   BY MARUCE SOLDADO 🇬🇳
========================================= */

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const { createClient } = require("@supabase/supabase-js");

const app = express();

const PORT = process.env.PORT || 3000;

/* =========================================
   CONFIGURATION
========================================= */

const SUPABASE_URL = process.env.SUPABASE_URL;

const SUPABASE_KEY =
    process.env.SUPABASE_SERVICE_ROLE_KEY;

const JWT_SECRET = process.env.JWT_SECRET;

/* DIAGNOSTIC SANS AFFICHER LES SECRETS */

console.log("NOVATALK CONFIGURATION:", {
    SUPABASE_URL: Boolean(SUPABASE_URL),
    SUPABASE_SERVICE_ROLE_KEY: Boolean(SUPABASE_KEY),
    JWT_SECRET: Boolean(JWT_SECRET)
});

if (!SUPABASE_URL || !SUPABASE_KEY || !JWT_SECRET) {
    console.error("NOVATALK: Configuration manquante.");
    process.exit(1);
}

/* =========================================
   SUPABASE
========================================= */

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

/* =========================================
   MIDDLEWARE
========================================= */

app.disable("x-powered-by");

app.use(helmet());

app.use(cors({
    origin: process.env.FRONTEND_URL || true
}));

app.use(express.json({
    limit: "20kb"
}));

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

/* =========================================
   JWT
========================================= */

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

/* =========================================
   AUTHENTIFICATION
========================================= */

function authenticate(req, res, next) {

    const header = req.headers.authorization;

    if (!header || !header.startsWith("Bearer ")) {
        return res.status(401).json({
            success: false,
            message: "Connexion requise."
        });
    }

    try {

        const token = header.substring(7);

        req.user = jwt.verify(
            token,
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

/* =========================================
   ACCUEIL
========================================= */

app.get("/", (req, res) => {

    res.json({
        success: true,
        application: "NOVATALK",
        slogan: "Connect the World 🌍",
        creator: "MARUCE SOLDADO 🇬🇳",
        version: "1.0.1",
        status: "online"
    });

});

/* =========================================
   HEALTH CHECK
========================================= */

app.get("/health", (req, res) => {

    res.json({
        success: true,
        server: "online",
        application: "NOVATALK",
        version: "1.0.1"
    });

});

/* =========================================
   INSCRIPTION
========================================= */

app.post(
    "/api/auth/register",
    authLimiter,
    async (req, res) => {

        try {

            const {
                full_name,
                username,
                password
            } = req.body;

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
                    message: "Nom complet invalide."
                });

            }

            if (!/^[a-z0-9_]{3,20}$/.test(user)) {

                return res.status(400).json({
                    success: false,
                    message: "Identifiant invalide. Utilisez 3 à 20 lettres, chiffres ou _."
                });

            }

            if (password.length < 8 || password.length > 72) {

                return res.status(400).json({
                    success: false,
                    message: "Le mot de passe doit contenir entre 8 et 72 caractères."
                });

            }

            /* HACHAGE DU MOT DE PASSE */

            const passwordHash = await bcrypt.hash(
                password,
                12
            );

            /* CRÉATION DU COMPTE */

            const { data, error } = await supabase
                .from("novatalk_users")
                .insert({
                    full_name: name,
                    username: user,
                    password_hash: passwordHash
                })
                .select(
                    "id, full_name, username, created_at"
                )
                .single();

            if (error) {

                if (error.code === "23505") {

                    return res.status(409).json({
                        success: false,
                        message: "Cet identifiant est déjà utilisé."
                    });

                }

                console.error("INSCRIPTION:", error.message);

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

            console.error("ERREUR INSCRIPTION:", error.message);

            return res.status(500).json({
                success: false,
                message: "Erreur interne du serveur."
            });

        }

    }
);

/* =========================================
   CONNEXION
========================================= */

app.post(
    "/api/auth/login",
    authLimiter,
    async (req, res) => {

        try {

            const {
                username,
                password
            } = req.body;

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

            /* RECHERCHE UTILISATEUR */

            const { data, error } = await supabase
                .from("novatalk_users")
                .select(
                    "id, full_name, username, password_hash, created_at"
                )
                .eq("username", user)
                .maybeSingle();

            if (error) {
                throw error;
            }

            /* VÉRIFICATION MOT DE PASSE */

            if (
                !data ||
                !(await bcrypt.compare(
                    password,
                    data.password_hash
                ))
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

            console.error("ERREUR CONNEXION:", error.message);

            return res.status(500).json({
                success: false,
                message: "Erreur interne du serveur."
            });

        }

    }
);

/* =========================================
   PROFIL UTILISATEUR
========================================= */

app.get(
    "/api/auth/me",
    authenticate,
    async (req, res) => {

        try {

            const { data, error } = await supabase
                .from("novatalk_users")
                .select(
                    "id, full_name, username, created_at"
                )
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

            console.error("ERREUR PROFIL:", error.message);

            return res.status(500).json({
                success: false,
                message: "Erreur serveur."
            });

        }

    }
);

/* =========================================
   DÉCONNEXION
========================================= */

app.post(
    "/api/auth/logout",
    authenticate,
    (req, res) => {

        res.json({
            success: true,
            message: "Déconnexion effectuée. Supprimez le jeton côté client."
        });

    }
);

/* =========================================
   ROUTES INCONNUES
========================================= */

app.use((req, res) => {

    res.status(404).json({
        success: false,
        message: "Route introuvable."
    });

});

/* =========================================
   ERREURS
========================================= */

app.use((error, req, res, next) => {

    console.error("ERREUR SERVEUR:", error.message);

    res.status(500).json({
        success: false,
        message: "Une erreur est survenue."
    });

});

/* =========================================
   DÉMARRAGE
========================================= */

app.listen(PORT, () => {

    console.log("--------------------------------");
    console.log("NOVATALK 🌍");
    console.log("CONNECT THE WORLD");
    console.log("BY MARUCE SOLDADO 🇬🇳");
    console.log("--------------------------------");
    console.log("VERSION: 1.0.1");
    console.log("SERVER: ONLINE");
    console.log("PORT:", PORT);
    console.log("--------------------------------");

});
