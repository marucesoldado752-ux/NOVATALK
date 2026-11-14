"use strict";

/* =====================================================
   NOVATALK 🌍 V1.0.2
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

/* =====================================================
   CONFIGURATION
===================================================== */

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

/* =====================================================
   SUPABASE
===================================================== */

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

/* =====================================================
   MIDDLEWARE
===================================================== */

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
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: "Trop de tentatives. Réessayez plus tard."
    }
});

/* =====================================================
   OUTIL DE DIAGNOSTIC
===================================================== */

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

/* =====================================================
   JWT
===================================================== */

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

/* =====================================================
   AUTHENTIFICATION
===================================================== */

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

/* =====================================================
   ACCUEIL
===================================================== */

app.get("/", (req, res) => {
    res.json({
        success: true,
        application: "NOVATALK",
        slogan: "Connect the World 🌍",
        creator: "MARUCE SOLDADO 🇬🇳",
        version: "1.0.2",
        status: "online"
    });
});

/* =====================================================
   HEALTH CHECK
===================================================== */

app.get("/health", (req, res) => {
    res.json({
        success: true,
        application: "NOVATALK",
        server: "online",
        database: "configured",
        version: "1.0.2"
    });
});

/* =====================================================
   INSCRIPTION
===================================================== */

app.post(
    "/api/auth/register",
    authLimiter,
    async (req, res) => {

        try {
            const {
                full_name,
                username,
                password
            } = req.body || {};

            /* VALIDATION */

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
                    message: "Le nom doit contenir entre 2 et 60 caractères."
                });
            }

            if (!/^[a-z0-9_]{3,20}$/.test(user)) {
                return res.status(400).json({
                    success: false,
                    message: "Identifiant invalide. Utilisez 3 à 20 lettres, chiffres ou underscores."
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

            /* ENREGISTREMENT SUPABASE */

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
                    message: "Impossible de créer le compte.",
                    error_code: error.code || "DATABASE_ERROR"
                });
            }

            /* CRÉATION DU TOKEN */

            const token = createToken(data);

            console.log(
                "NOVATALK : nouveau compte créé :",
                data.username
            );

            return res.status(201).json({
                success: true,
                message: "Bienvenue sur NOVATALK !",
                token,
                user: data
            });

        } catch (error) {

            console.error(
                "ERREUR INTERNE INSCRIPTION:",
                error.message
            );

            return res.status(500).json({
                success: false,
                message: "Erreur interne pendant l'inscription."
            });
        }
    }
);

/* =====================================================
   CONNEXION
===================================================== */

app.post(
    "/api/auth/login",
    authLimiter,
    async (req, res) => {

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

            /* RECHERCHE DU COMPTE */

            const { data, error } = await supabase
                .from("novatalk_users")
                .select(
                    "id, full_name, username, password_hash, created_at"
                )
                .eq("username", user)
                .maybeSingle();

            if (error) {
                logDatabaseError("CONNEXION", error);

                return res.status(500).json({
                    success: false,
                    message: "Impossible de vérifier le compte."
                });
            }

            /* VÉRIFICATION DU MOT DE PASSE */

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

            console.log(
                "NOVATALK : connexion réussie :",
                data.username
            );

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

            console.error(
                "ERREUR INTERNE CONNEXION:",
                error.message
            );

            return res.status(500).json({
                success: false,
                message: "Erreur interne pendant la connexion."
            });
        }
    }
);

/* =====================================================
   PROFIL UTILISATEUR
===================================================== */

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

            if (error) {
                logDatabaseError("PROFIL", error);

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

            console.error(
                "ERREUR PROFIL:",
                error.message
            );

            return res.status(500).json({
                success: false,
                message: "Erreur serveur."
            });
        }
    }
);

/* =====================================================
   DÉCONNEXION
===================================================== */

app.post(
    "/api/auth/logout",
    authenticate,
    (req, res) => {

        return res.json({
            success: true,
            message: "Déconnexion effectuée. Supprimez le jeton côté client."
        });
    }
);

/* =====================================================
   ROUTES INCONNUES
===================================================== */

app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: "Route introuvable."
    });
});

/* =====================================================
   GESTION DES ERREURS
===================================================== */

app.use((error, req, res, next) => {

    console.error(
        "ERREUR SERVEUR:",
        error.message
    );

    if (res.headersSent) {
        return next(error);
    }

    res.status(500).json({
        success: false,
        message: "Une erreur est survenue."
    });
});

/* =====================================================
   DÉMARRAGE
===================================================== */

app.listen(PORT, () => {

    console.log("--------------------------------");
    console.log("NOVATALK 🌍");
    console.log("CONNECT THE WORLD");
    console.log("BY MARUCE SOLDADO 🇬🇳");
    console.log("--------------------------------");
    console.log("VERSION: 1.0.2");
    console.log("SERVER: ONLINE");
    console.log("PORT:", PORT);
    console.log("--------------------------------");

});
