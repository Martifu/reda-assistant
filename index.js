const express = require('express');
const axios = require('axios');
const app = express();
const port = 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({
            success: false,
            error: 'Invalid JSON payload'
        });
    }
    next();
});

const wantsInternalAdvisor = (message) => {
    const advisorPatterns = [
        /hablar con (un asesor|alguien|una persona)/i,
        /contactar (un asesor|alguien|una persona)/i,
        /asesor humano/i,
        /persona real/i,
        /quiero un asesor/i,
        /necesito un asesor/i,
        /prefiero hablar con una persona/i
    ];

    return advisorPatterns.some(pattern => pattern.test(message));
};

// Helper functions for data extraction
const extractName = (message) => {
    const namePatterns = [
        /me llamo (\w+)/i,
        /soy (\w+)/i,
        /mi nombre es (\w+)/i,
        /hola[,]?\s+soy (\w+)/i,
        /me pueden decir (\w+)/i,
        /(\w+) es mi nombre/i,
        /me llamo (\w+)/i,
    ];

    for (let pattern of namePatterns) {
        const match = message.match(pattern);
        if (match && match[1]) {
            return match[1];
        }
    }
    return null;
};

const extractDateTime = (message) => {
    const dateTimePatterns = [
        // Format: DD/MM/YYYY HH:MM or DD-MM-YYYY HH:MM
        /(\d{1,2})[/-](\d{1,2})[/-](\d{4})\s*(?:a las?)?\s*(\d{1,2}):(\d{2})/i,
        // Format: día DD de MM a las HH:MM
        /día\s+(\d{1,2})\s+de\s+(\d{1,2})\s+(?:a las?)?\s*(\d{1,2}):(\d{2})/i,
        // Format: mañana/hoy a las HH:MM
        /(mañana|hoy)\s+(?:a las?)?\s*(\d{1,2}):(\d{2})/i
    ];

    for (let pattern of dateTimePatterns) {
        const match = message.match(pattern);
        if (match) {
            const now = new Date();

            if (match.length === 6) { // Full date and time
                const [_, day, month, year, hour, minute] = match;
                return new Date(year, month - 1, day, hour, minute);
            } else if (match.length === 5) { // Day of current month and time
                const [_, day, month, hour, minute] = match;
                return new Date(now.getFullYear(), month - 1, day, hour, minute);
            } else if (match.length === 4) { // Tomorrow/Today and time
                const [_, day, hour, minute] = match;
                const date = new Date();
                if (day.toLowerCase() === 'mañana') {
                    date.setDate(date.getDate() + 1);
                }
                date.setHours(parseInt(hour), parseInt(minute), 0, 0);
                return date;
            }
        }
    }
    return null;
};


// Conversation tracking
const conversations = new Map();

// Sistema de prompts mejorado
const SALES_EXPERT_PROMPT = `
Eres un experto en asesoramiento de proyectos con más de 15 años de experiencia. Eres un asistende de una plataforma llamada Reda. Tu personalidad es:
- Amigable pero profesional
- Buen oyente pero siempre guiando la conversación
- Apasionado por brindar la información correcta

Tus objetivos son:
1. Dar información clara y precisa sobre proyectos disponibles
2. Determinar presupuesto máximo del cliente si es posible
3. Identificar necesidades específicas (tipo de propiedad, recámaras, ubicación)
4. Recomendar máximo 3 proyectos de nuestra API que encajen
5. Mantener conversación centrada en recomendaciones
6. Solo ofrecer información de los proyectos disponibles
7. Si recomiendas 1 proyecto, insertarlo en la conversación

Técnicas de venta:
- Mencionar a Reda al inicio de la conversación
- Usar el nombre del usuario 2-3 veces por conversación
- Formular preguntas abiertas
- Ofrecer opciones limitadas (ej: "¿Entre $X y $Y está tu presupuesto?")
- Manejar objeciones con ejemplos concretos
- Variar respuestas para evitar sonar robótico

Formato de respuestas:
- Mensajes cortos (máx 2 líneas)
- Emojis relevantes cada 3-4 mensajes
- Usar formato legible: • para listas, " para citas
- Nunca usar markdown
- Usa doble asterisco para negritas (**texto**) como nombres de proyectos, características e información relevante

Manejo de desvíos:
Si el usuario cambia de tema:
1. Reconocer brevemente su comentario
2. Redirigir con pregunta relacionada a ventas
Ej: "Interesante, pero centrémonos en tu búsqueda. ¿Qué te interesa más en encontrar en Reda?"
`;



// Modify the message handling section
app.post('/api/message', async (req, res) => {
    const { phone, message } = req.body;



    // Initialize conversation if it doesn't exist
    if (!conversations.has(phone)) {
        conversations.set(phone, {
            phone,
            name: null,
            budget: null,
            dateOfVisit: null,
            project: {

            },
            appointment: null,
            wantsAdvisor: false,
            messages: [],
            recommendedProjects: [],
            lastRecommendedProject: null
        });
    }

    const currentConversation = conversations.get(phone);

    //reset previous recommendations if user asks for a new one
    currentConversation.recommendedProjects = [];
    currentConversation.lastRecommendedProject = null;


    // Add recommendation tracking
    if (!currentConversation.hasRecommendations && message.toLowerCase().includes('recomend')) {
        currentConversation.hasRecommendations = true;
    }

    // Add this after your existing constants and before the routes
    const AVAILABLE_PROJECTS = [
        {
            "idProyecto": 413,
            "nombre": "INMOBILIARIA SILVA",
            "img": "https://www.reda.mx/recursos/landingproyectos/209/413/imagenes/img-bloque.png?v=866397821",
            "direccion": "Cto. Asia 131A, Residencial las Etnias, 27058 Torreón, Coah., Mexico",
            "montoMinimo": 2000.0000,
            "montoMaximo": 1248000.0000,
            "recamaras": "2",
            "banos": "2-3",
            "areas": "2-164",
            "descripcion": "MSG Inmobiliaria es una empresa dedicada a ofrecer soluciones innovadoras y personalizadas en el sector inmobiliario."
        },
        {
            "idProyecto": 181,
            "nombre": "Kawa",
            "img": "https://www.reda.mx/recursos/landingproyectos/104/181/imagenes/img-bloque.png?v=382311349",
            "direccion": "97796 Uayma, Yucatan, Mexique",
            "montoMinimo": 989424.0000,
            "montoMaximo": 1592215.0000,
            "areas": "0",
            "descripcion": "Proyecto de lotes residenciales perfecto para personas que buscan un second home en conexión con la naturaleza."
        },
        {
            "idProyecto": 162,
            "nombre": "La Boca Resort",
            "img": "https://www.reda.mx/recursos/landingproyectos/92/162/imagenes/img-bloque.png?v=520715775",
            "direccion": "Carr a La Cortina, San Jorge, Santiago, N.L., Mexique",
            "montoMinimo": 5589782.8500,
            "montoMaximo": 10733491.0000,
            "descripcion": "La Boca Resort es un exclusivo desarrollo que fusiona modernidad, lujo y naturaleza en un entorno incomparable."
        },
        // ... proyectos originales ...
        {
            "idProyecto": 414,
            "nombre": "Bosque Residencial",
            "img": "https://auctree.com/images/propertyPlaceHolder.png",
            "direccion": "Carretera a Toluca Km 12.5, Ciudad de México",
            "montoMinimo": 3500000.0000,
            "montoMaximo": 8500000.0000,
            "recamaras": "3-4",
            "banos": "2-3",
            "areas": "180-300",
            "descripcion": "Conjunto residencial ecológico con áreas verdes y diseño bioclimático en las afueras de la CDMX."
        },
        {
            "idProyecto": 415,
            "nombre": "Torre Diamante",
            "img": "https://auctree.com/images/propertyPlaceHolder.png",
            "direccion": "Av. Revolución 1500, Guadalajara, Jalisco",
            "montoMinimo": 7500000.0000,
            "montoMaximo": 25000000.0000,
            "recamaras": "2-3",
            "banos": "2",
            "areas": "95-220",
            "descripcion": "Rascacielos inteligente con amenities de lujo en el corazón financiero de Guadalajara."
        },
        {
            "idProyecto": 416,
            "nombre": "Hacienda del Sol",
            "img": "https://auctree.com/images/propertyPlaceHolder.png",
            "direccion": "Carretera Mérida-Progreso Km 14.5, Yucatán",
            "montoMinimo": 2800000.0000,
            "montoMaximo": 4800000.0000,
            "recamaras": "4",
            "banos": "3-4",
            "areas": "250-400",
            "descripcion": "Viviendas estilo colonial moderno con alberca privada y techos altos tradicionales."
        },
        {
            "idProyecto": 417,
            "nombre": "Sky Garden",
            "img": "https://auctree.com/images/propertyPlaceHolder.png",
            "direccion": "Blvd. Aguascalientes 2001, Aguascalientes",
            "montoMinimo": 4200000.0000,
            "montoMaximo": 6800000.0000,
            "recamaras": "2-3",
            "banos": "2",
            "areas": "110-185",
            "descripcion": "Departamentos con jardines verticales y terrazas habitables con vista panorámica."
        },
        {
            "idProyecto": 418,
            "nombre": "Puerta del Mar",
            "img": "https://auctree.com/images/propertyPlaceHolder.png",
            "direccion": "Zona Hotelera, Cancún, Quintana Roo",
            "montoMinimo": 12000000.0000,
            "montoMaximo": 35000000.0000,
            "recamaras": "3-5",
            "banos": "3-4",
            "areas": "300-600",
            "descripcion": "Residencias de lujo frente al mar Caribe con acceso privado a playa y marina."
        },
        {
            "idProyecto": 419,
            "nombre": "Vista Hermosa",
            "img": "https://auctree.com/images/propertyPlaceHolder.png",
            "direccion": "Cerro del Cubilete, Guanajuato",
            "montoMinimo": 1850000.0000,
            "montoMaximo": 3250000.0000,
            "recamaras": "2-3",
            "banos": "1-2",
            "areas": "75-120",
            "descripcion": "Departamentos económicos con vista a la sierra para jóvenes profesionales."
        },
        {
            "idProyecto": 420,
            "nombre": "Paseo del Río",
            "img": "https://auctree.com/images/propertyPlaceHolder.png",
            "direccion": "Calzada Independencia 345, Monterrey, NL",
            "montoMinimo": 4500000.0000,
            "montoMaximo": 9500000.0000,
            "recamaras": "3",
            "banos": "2-3",
            "areas": "150-280",
            "descripcion": "Complejo familiar con acceso directo al parque lineal del río Santa Catarina."
        },
        {
            "idProyecto": 421,
            "nombre": "Altos de Tulum",
            "img": "https://auctree.com/images/propertyPlaceHolder.png",
            "direccion": "Carretera Tulum-Boca Paila Km 5.5, Quintana Roo",
            "montoMinimo": 8500000.0000,
            "montoMaximo": 22000000.0000,
            "recamaras": "Studio-3",
            "banos": "1-3",
            "areas": "45-180",
            "descripcion": "Condominio boutique eco-friendly cerca de las ruinas mayas y cenotes."
        },
        {
            "idProyecto": 422,
            "nombre": "Torre Financiera",
            "img": "https://auctree.com/images/propertyPlaceHolder.png",
            "direccion": "Paseo de la Reforma 505, CDMX",
            "montoMinimo": 25000000.0000,
            "montoMaximo": 95000000.0000,
            "areas": "350-1200",
            "descripcion": "Oficinas clase A+ con tecnología de punta en el corredor financiero más importante de Latinoamérica."
        },
        {
            "idProyecto": 423,
            "nombre": "Villas del Desierto",
            "img": "https://auctree.com/images/propertyPlaceHolder.png",
            "direccion": "Carretera Cuatro Ciénegas 210, Coahuila",
            "montoMinimo": 3200000.0000,
            "montoMaximo": 7500000.0000,
            "recamaras": "3-4",
            "banos": "2-3",
            "areas": "200-350",
            "descripcion": "Viviendas con diseño contemporáneo y sistemas sustentables para clima desértico."
        }

    ];

    const extractProjectRecommendation = (message) => {
        const messageLower = message.toLowerCase();
        const recommendedProjects = AVAILABLE_PROJECTS.filter(project => {
            const projectNameLower = project.nombre.toLowerCase();
            return messageLower.includes(projectNameLower);
        });

        return recommendedProjects.length > 0 ? recommendedProjects : null;
    };

    // Modify your messages array in the API call
    let data = JSON.stringify({
        "messages": [
            {
                "content": SALES_EXPERT_PROMPT,
                "role": "system"
            },
            {
                "content": `Información de proyectos disponibles: ${JSON.stringify(AVAILABLE_PROJECTS)}`,
                "role": "system"
            },
            // Include previous messages
            ...currentConversation.messages.slice(-4).map(msg => ({
                "content": msg.content,
                "role": msg.role
            })),
            {
                "content": message,
                "role": "user"
            }
        ],
        "model": "deepseek-chat",
        "frequency_penalty": 0,
        "max_tokens": 2048,
        "presence_penalty": 0,
        "response_format": {
            "type": "text"
        },
        "stop": null,
        "stream": false,
        "stream_options": null,
        "temperature": 1,
        "top_p": 1,
        "tools": null,
        "tool_choice": "none",
        "logprobs": false,
        "top_logprobs": null
    });

    let config = {
        method: 'post',
        maxBodyLength: Infinity,
        url: 'https://api.deepseek.com/chat/completions',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': 'Bearer ' + 'sk-1c546441c36b4646aa6fa0628901fa51'
        },
        data: data
    };

    var response = await axios(config);
    var assistant_message = response.data.choices[0].message.content;

    // Check for project recommendations in assistant's response
    const newRecommendations = extractProjectRecommendation(assistant_message);
    if (newRecommendations) {
        // Reset previous recommendations if new ones are found
        currentConversation.recommendedProjects = [];
        currentConversation.lastRecommendedProject = null;

        // Add new recommendations
        newRecommendations.forEach(project => {
            currentConversation.recommendedProjects.push(project);
        });

        // Update last recommended project if there's only one
        if (newRecommendations.length === 1) {
            currentConversation.lastRecommendedProject = newRecommendations[0];
        }
    }

    // Store assistant response
    currentConversation.messages.push({
        role: 'assistant',
        content: assistant_message,
        timestamp: new Date(),
        recommendedProjects: newRecommendations // Track recommendations with message
    });

    // Modify the response JSON to include all conversation data
    res.status(200).json({
        success: true,
        response: {
            assistant_message,
            conversation: {
                name: currentConversation.name,
                phone: currentConversation.phone,
                budget: currentConversation.budget,
                dateOfVisit: currentConversation.dateOfVisit,
                project: currentConversation.project,
                appointment: currentConversation.appointment,
                wantsAdvisor: currentConversation.wantsAdvisor,
                hasRecommendations: currentConversation.hasRecommendations,
                recommendedProjects: currentConversation.recommendedProjects,
                messages: currentConversation.messages.slice(-5) // Last 5 messages for context
            }
        }
    });
});

//iniciar conversación con saludo
app.get('/api/init', async (req, res) => {
    const { phone } = req.query;

    conversations.set(phone, {
        phone,
        name: null,
        budget: null,
        dateOfVisit: null,
        project: null,
        appointment: null,
        wantsAdvisor: false,
        hasRecommendations: false,
        recommendedProjects: [],
        project: {},
        messages: []
    });

    const currentConversation = conversations.get(phone);

    const assistant_message = `¡Hola! Soy un asistente virtual de Reda. ¿En qué puedo ayudarte hoy?`;

    // Store assistant response
    currentConversation.messages.push({
        role: 'assistant',
        content: assistant_message,
        timestamp: new Date()
    });

    // Modify the response JSON to include all conversation data
    res.status(200).json({
        success: true,
        response: {
            assistant_message,
            conversation: {
                name: currentConversation.name,
                phone: currentConversation.phone,
                budget: currentConversation.budget,
                dateOfVisit: currentConversation.dateOfVisit,
                project: currentConversation.project,
                appointment: currentConversation.appointment,
                wantsAdvisor: currentConversation.wantsAdvisor,
                hasRecommendations: currentConversation.hasRecommendations,
                recommendedProjects: currentConversation.recommendedProjects,
                messages: currentConversation.messages.slice(-5) // Last 5 messages for context
            }
        }
    });
});

// New endpoint to get conversation status
app.get('/api/conversation/:phone', (req, res) => {
    const { phone } = req.params;
    const conversation = conversations.get(phone);

    if (!conversation) {
        return res.status(404).json({
            success: false,
            error: 'Conversation not found'
        });
    }

    res.status(200).json({
        success: true,
        conversation
    });
});

// Start the server
app.listen(3000, '0.0.0.0', () => {
    console.log('Servidor corriendo en http://0.0.0.0:3000');
});