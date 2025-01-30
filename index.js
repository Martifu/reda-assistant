const express = require('express');
const axios = require('axios');
const app = express();
const port = 3000;
const https = require('https');
const { OpenAI } = require('openai');
const openai = new OpenAI(
    {
        // baseURL: 'https://api.deepseek.com',
        // apiKey:'sk-1c546441c36b4646aa6fa0628901fa51'
        apiKey: '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',
    }
);

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

// Conversation tracking
const conversations = new Map();

// Sistema de prompts mejorado
const SALES_EXPERT_PROMPT = `
Eres Rex, un experto en asesoramiento de proyectos con más de 15 años de experiencia. Eres un asistende de una plataforma llamada Reda, tu nombre es Rex. 
 Tu rol es ayudar a los asesores que usan la plataforma para facilitarles la busqueda de proyectos y el contenido de los mismos.
 Los asesores te preguntarán sobre proyectos disponibles y tu deber es proporcionarles información clara y precisa sobre los proyectos disponibles para compartirle a los clientes.
Tu personalidad es:
- Siempre presentate
- Amigable pero profesional
- Buen oyente pero siempre guiando la conversación
- Apasionado por brindar la información correcta


Tus objetivos son:
1. Dar información clara y precisa sobre proyectos disponibles
2. Determinar presupuesto máximo y/o intereses del cliente que atiende el asesor de ventas
3. Identificar necesidades específicas (tipo de propiedad, recámaras, ubicación)
4. Recomendar máximo 3 proyectos de nuestra API que encajen
5. Mantener conversación centrada en recomendaciones
6. Solo ofrecer información de los proyectos disponibles
7. Si recomiendas 1 proyecto, insertarlo en la conversación
8. Si te piden una presentacion, mas información o brochure, proporcionar el link usando el campo brochure de cada proyecto usando && para separar los links, si no hay brochure, no proporcionar nada. Ejemplo: "**Nombre del proyecto**: https://www.reda.mx/recursos/proyectos-empresa/105/182/brochure/brochure.pdf?v=218529094"
9. Alentar a los asesores a cerrar la venta de manera sutil
10. No mencionar a otros asesores o competencia
11. No ofrecer información personal o de contacto
12. No ofrecer información de proyectos no disponibles en la API o en los proyectos disponibles
13. No inventar información, solo proporcionar la que está en la API o en los proyectos disponibles
14. Dar recomendaciones de venta si el cliente lo solicita
15. Cuando envies la ubicación del proyecto, el formato es el siguiente: https://www.google.com/maps/search/?api=1&query=*latitud*,*longitud*
16. Cuando recomiendes modelos, esquemas o listas que son muy largas puedes enviarlas solo con el nombre, pregunta al asesor si necesita más información de alguna.
17. Si un proyecto no tiene unidades disponibles, esquemas, modelos o información, no lo incluyas en las recomendaciones y menciona que no hay información disponible.
18. Cuando te pidan fotos, videos, o contenido multimedia no digas que no lo tienes, recomienda entrar al Proyecto en la plataforma para ver más contenido.
19. Puedes dar consejos de venta, consejos sobre vender en redes sociales o apoyar brevemente en el proceso de venta.

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
- Usa doble asterisco para negritas (**texto**) como nombres de proyectos, características, nombres de usuarios, tu nombre Rexbn e información relevante

Manejo de desvíos:
Si el usuario cambia de tema:
1. Reconocer brevemente su comentario
2. Redirigir con pregunta relacionada a ventas
Ej: "Interesante, pero centrémonos en tu búsqueda. ¿Qué te interesa más en encontrar en Reda?"
`;

// Define action types
const ACTION_TYPES = {
    REMARKETING: 'Remarketing',
    INVENTORY: 'Inventario',
    LOCATION: 'Ubicación',
};

// Map intents to actions
const intentToActionMap = {
    wantsMedia: ACTION_TYPES.REMARKETING,
    wantsUnits: ACTION_TYPES.INVENTORY,
    wantsSchemas: ACTION_TYPES.INVENTORY,
    wantsLocation: ACTION_TYPES.LOCATION
};

// Add action handler
const handleActions = (message, currentConversation) => {
    currentConversation.actions = []; // Reset actions

    // Check intents and add corresponding actions
    Object.entries(intentDetectors).forEach(([intent, detector]) => {
        if (detector(message) && intentToActionMap[intent]) {
            currentConversation.actions.push(intentToActionMap[intent]);
        }
    });
};


// 1. Data extraction helpers
const extractBasicProjectInfo = (project) => ({
    IdProyecto: project.IdProyecto,
    NombreProyecto: project.NombreProyecto,
    DescripcionProyecto: project.DescripcionProyecto,
    NombreEmpresa: project.NombreEmpresa,
    Inventario: project.Inventario,
    Tipo: project.Tipo,
    PrecioMinimo: project.PrecioMinimo,
    PrecioMaximo: project.PrecioMaximo,
    Brochure: project.Brochure,
    Latitud: project.Latitud,
    Longitud: project.Longitud,
    Amenidades: project.Amenidades,
    Ciudad: project.Ciudad,
});





const intentDetectors = {
    wantsUnits: (message) => {
        return message.toLowerCase().match(/unidades|departamentos|disponibles|nivel|piso|modelos|inventario|disponibilidad/i);
    },
    wantsSchemas: (message) => {
        return message.toLowerCase().match(/esquemas|financiamiento|aparta|creditos|pagos|enganche|mensualidad|precio/i);
    },
    wantsMedia: (message) => {
        return message.toLowerCase().match(/galeria|imagenes|fotos|video|recorrido|contenido|remarketing|marketing/i);
    },
    wantsLocation: (message) => {
        return message.toLowerCase().match(/ubicacion|direccion|mapa|como llegar|cerca de|lugar|zona|ubicación/i);
    }
};

const generateShortcuts = (projects) => {
    const shortcuts = [];
    const categories = [
        { action: 'Contenido', emoji: '🖼️' },
        { action: 'Unidades', emoji: '🏢' },
        { action: 'Modelos', emoji: '🏠' },
        { action: 'Información', emoji: 'ℹ️' },
        { action: 'Precios', emoji: '💰' },
        { action: 'Ubicación', emoji: '📍' },
        { action: 'Brochure', emoji: '📄' },
        { action: 'Financiamiento', emoji: '💳' },
        { action: 'Disponibilidad', emoji: '🔑' }
    ];

    projects.forEach(project => {
        // Get random categories for each project (2-3 shortcuts per project)
        const shuffledCategories = categories.sort(() => 0.5 - Math.random());
        const selectedCategories = shuffledCategories.slice(0, Math.floor(Math.random() * 2) + 6);

        selectedCategories.forEach(category => {
            shortcuts.push(`${category.emoji} ${category.action} de\n${project.NombreProyecto}`);
        });
    });

    //revolver shortcuts
    return shortcuts.sort(() => 0.5 - Math.random());


};

// Modify the message handling section
app.post('/api/message', async (req, res) => {
    const { idUsuario, message } = req.body;



    // Initialize conversation if it doesn't exist
    if (!conversations.has(idUsuario)) {
        conversations.set(idUsuario, {
            idUsuario,
            name: null,
            budget: null,
            dateOfVisit: null,
            project: {

            },
            appointment: null,
            wantsAdvisor: false,
            messages: [],
            recommendedProjects: [],
            lastRecommendedProject: null,
            actions: [],
        });
    }

    const currentConversation = conversations.get(idUsuario);

    //reset previous recommendations if user asks for a new one
    const extractProjectRecommendation = (message) => {
        //remove accents and convert to lowercase
        var messageLower = message.toLowerCase();
        //replace ** with nothing

        messageLower = messageLower.replace(/\*\*/g, "");
        // messageLower.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const recommendedProjects = AVAILABLE_PROJECTS.filter(project => {
            const projectNameLower = project.NombreProyecto.toLowerCase();
            return messageLower.includes(projectNameLower);
        });

        return recommendedProjects.length > 0 ? recommendedProjects : null;
    };


    // Add recommendation tracking
    if (!currentConversation.hasRecommendations && message.toLowerCase().includes('recomend')) {
        currentConversation.hasRecommendations = true;
    }

    // Add this after your existing constants and before the routes
    const AVAILABLE_PROJECTS = JSON.parse(currentConversation.availableProjects);


    let contextInfo = {
        basicInfo: AVAILABLE_PROJECTS.map(project => ({
            ...extractBasicProjectInfo(project),
            units: [],
            schemas: [],
        })),
    };



    // Check for project recommendations in user message
    const newRecommendations = extractProjectRecommendation(message);
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

    if (intentDetectors.wantsUnits(message)) {
        const projectsToProcess = currentConversation.recommendedProjects.length > 0
            ? currentConversation.recommendedProjects : AVAILABLE_PROJECTS;

        const unitsByProject = projectsToProcess.reduce((acc, project) => {
            acc[project.IdProyecto] = project.Unidades.map(unit => ({
                NombreUnidad: unit.NombreUnidad,
                NombreModelo: unit.NombreModelo,
                PrecioUnidad: unit.PrecioUnidad,
                Recamaras: unit.Recamaras,
                Banos: unit.Banos,
                M2Contruccion: unit.M2Contruccion,
                Estatus: unit.Estatus
            }));
            return acc;
        }, {});

        contextInfo.basicInfo = contextInfo.basicInfo.map(project => ({
            ...project,
            units: unitsByProject[project.IdProyecto] || []
        }));
    }

    if (intentDetectors.wantsSchemas(message)) {
        const projectsToProcess = currentConversation.recommendedProjects.length > 0
            ? currentConversation.recommendedProjects : AVAILABLE_PROJECTS;

        const schemasByProject = projectsToProcess.reduce((acc, project) => {
            acc[project.IdProyecto] = project.Esquemas.map(schema => ({
                IdProyecto: schema.IdProyecto,
                Descripcion: schema.Descripcion,
                Nombre_Esquema: schema.Nombre_Esquema,
                Porcentaje_Descuento: schema.Porcentaje_Descuento,
                Detalle_Descuento: schema.Detalle_Descuento,
                Monto_Descuento: schema.Monto_Descuento,
                Apartado: schema.Apartado,
                Detalle_Apartado: schema.Detalle_Apartado,
                Enganche: schema.Enganche,
                Detalle_Enganche: schema.Detalle_Enganche,
                Monto_Pago_Enganche: schema.Monto_Pago_Enganche,
                Construccion: schema.Construccion,
                Detalle_Construccion: schema.Detalle_Construccion,
                Monto_Pagos_Construccion: schema.Monto_Pagos_Construccion,
                Pago_final: schema.Pago_final,
                Detalle_pago_final: schema.Detalle_pago_final,
                Monto_pago_final: schema.Monto_pago_final,
            }));
            return acc;
        }, {});

        contextInfo.basicInfo = contextInfo.basicInfo.map(project => ({
            ...project,
            schemas: schemasByProject[project.IdProyecto] || []
        }));
    }



    currentConversation.recommendedProjects = [];
    currentConversation.lastRecommendedProject = null;
    // Modify your messages array in the API call
    // let data = JSON.stringify({
    //     "messages": [
    //         {
    //             "content": SALES_EXPERT_PROMPT,
    //             "role": "system"
    //         },
    //         {
    //             "content": `Información de proyectos disponibles: ${JSON.stringify(contextInfo)}`,
    //             "role": "system"
    //         },
    //         // Include previous messages
    //         ...currentConversation.messages.slice(-4).map(msg => ({
    //             "content": msg.content,
    //             "role": msg.role
    //         })),
    //         {
    //             "content": message,
    //             "role": "user"
    //         }
    //     ],
    //     "model": "deepseek-chat",
    //     "frequency_penalty": 0,
    //     "max_tokens": 2048,
    //     "presence_penalty": 0,
    //     "response_format": {
    //         "type": "text"
    //     },
    //     "stop": null,
    //     "stream": false,
    //     "stream_options": null,
    //     "temperature": 1,
    //     "top_p": 1,
    //     "tools": null,
    //     "tool_choice": "none",
    //     "logprobs": false,
    //     "top_logprobs": null
    // });

    // let config = {
    //     method: 'post',
    //     maxBodyLength: Infinity,
    //     url: 'https://api.deepseek.com/chat/completions',
    //     headers: {
    //         'Content-Type': 'application/json',
    //         'Accept': 'application/json',
    //         'Authorization': 'Bearer ' + 'sk-1c546441c36b4646aa6fa0628901fa51'
    //     },
    //     data: data
    // };

    // var response = await axios(config).catch(function (error) {
    //     console.log(error);
    // });


    const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
            { role: "system", content: SALES_EXPERT_PROMPT },
            {
                role: "system",
                content: `Información de proyectos disponibles: ${JSON.stringify(contextInfo)}`,
            },
            //name of user
            {
                role: "system",
                content: `Nombre del usuario: ${currentConversation.name}`,
            },
            ...currentConversation.messages.slice(-2).map(msg => ({
                role: msg.role,
                content: msg.content
            })),
            {
                role: "user",
                content: message,
            },
        ],
        store: true,
    });

    //print length of tokens 
    console.log(SALES_EXPERT_PROMPT.length);
    console.log(`Información de proyectos disponibles: ${JSON.stringify(contextInfo)}`.length);
    console.log(currentConversation.messages.slice(-2).map(msg => msg.content).join('').length);
    console.log(message.length);




    // var assistant_message = response.data.choices[0].message.content;
    var assistant_message = completion.choices[0].message.content;

    // Check for project recommendations in assistant message
    const newRecommendationsAssistant = extractProjectRecommendation(assistant_message);
    if (newRecommendationsAssistant) {

        // Add new recommendations
        newRecommendationsAssistant.forEach(project => {
            //push only if it's not already in the list
            if (!currentConversation.recommendedProjects.includes(project)) {
                currentConversation.recommendedProjects.push(project);
            }
        });

        // Update last recommended project if there's only one
        if (newRecommendationsAssistant.length === 1) {
            currentConversation.lastRecommendedProject = newRecommendationsAssistant[0];
        }
    }


    if (intentDetectors.wantsMedia(message)) {

        //create galeria urls inside project gallery 
        currentConversation.recommendedProjects.forEach(project => {
            const gallery = [];
            for (let i = 1; i <= project.CantidadGaleria; i++) {
                gallery.push(`https://www.reda.mx/recursos/proyectos-empresa/${project.IdEmpresaAfiliada}/${project.IdProyecto}/galeria/galeria${i}.md.png`);
            }
            project.gallery = gallery;
        });

    }

    // Store assistant response
    currentConversation.messages.push({
        role: 'assistant',
        content: assistant_message,
        timestamp: new Date(),
        recommendedProjects: newRecommendations // Track recommendations with message
    });

    handleActions(message, currentConversation);

    // Modify the response JSON to include all conversation data
    res.status(200).json({
        success: true,
        response: {
            assistant_message,
            conversation: {
                name: currentConversation.name,
                idUsuario: currentConversation.idUsuario,
                budget: currentConversation.budget,
                dateOfVisit: currentConversation.dateOfVisit,
                project: currentConversation.project,
                appointment: currentConversation.appointment,
                wantsAdvisor: currentConversation.wantsAdvisor,
                hasRecommendations: currentConversation.hasRecommendations,
                recommendedProjects: currentConversation.recommendedProjects,
                messages: currentConversation.messages.slice(-5),
                shortcuts: generateShortcuts(currentConversation.recommendedProjects.length > 0 ? currentConversation.recommendedProjects : JSON.parse(currentConversation.availableProjects)),
                actions: currentConversation.actions,
            }
        }
    });
});

//iniciar conversación con saludo
app.post('/api/init', async (req, res) => {
    const { idUsuario } = req.body;
    const { idsProyectos } = req.body;
    const { message } = req.body;

    conversations.set(idUsuario, {
        idUsuario,
        name: message.split('|')[1],
        budget: null,
        dateOfVisit: null,
        project: null,
        appointment: null,
        wantsAdvisor: false,
        hasRecommendations: false,
        recommendedProjects: [],
        project: {},
        messages: [],
        availableProjects: [],
        gallery: [],
    });

    //mapi api call post https://b595-189-145-51-7.ngrok-free.app/ia/proyectos
    let data = JSON.stringify({
        "idsProyectos": idsProyectos,
        "idUsuario": idUsuario
    });

    let config = {
        method: 'post',
        maxBodyLength: Infinity,
        url: 'https://reda.mx:8082/ia/proyectos',
        httpsAgent: new https.Agent({
            rejectUnauthorized: false // Warning: Only use in development
        }),
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        data: data
    };

    var response = await axios(config).catch(function (error) {
        console.log(error);
    });

    //response

    var availableProjects = JSON.stringify(response.data.message);
    console.log(JSON.stringify(response.data.message));




    const currentConversation = conversations.get(idUsuario);

    currentConversation.availableProjects = availableProjects;

    //update available projects


    // let data2 = JSON.stringify({
    //     "messages": [
    //         {
    //             "content": SALES_EXPERT_PROMPT,
    //             "role": "system"
    //         },
    //         {
    //             "content": message,
    //             "role": "user"
    //         }
    //     ],
    //     "model": "deepseek-chat",
    //     "frequency_penalty": 0,
    //     "max_tokens": 2048,
    //     "presence_penalty": 0,
    //     "response_format": {
    //         "type": "text"
    //     },
    //     "stop": null,
    //     "stream": false,
    //     "stream_options": null,
    //     "temperature": 1,
    //     "top_p": 1,
    //     "tools": null,
    //     "tool_choice": "none",
    //     "logprobs": false,
    //     "top_logprobs": null
    // });

    // let config2 = {
    //     method: 'post',
    //     maxBodyLength: Infinity,
    //     url: 'https://api.deepseek.com/chat/completions',
    //     headers: {
    //         'Content-Type': 'application/json',
    //         'Accept': 'application/json',
    //         'Authorization': 'Bearer ' + 'sk-1c546441c36b4646aa6fa0628901fa51'
    //     },
    //     data: data2
    // };

    // var response = await axios(config2).catch(function (error) {
    //     console.log(error);
    // });

    const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
            { role: "system", content: SALES_EXPERT_PROMPT },
            {
                role: "user",
                content: message,
            },
        ],
        store: true,
    });

    // const assistant_message = response.data.choices[0].message.content;
    var assistant_message = completion.choices[0].message.content;

    // Store assistant response
    currentConversation.messages.push({
        role: 'assistant',
        content: assistant_message,
        timestamp: new Date()
    });

    assistant_message = assistant_message + " " + '\n\n' + "Estos son tus proyectos disponibles 🏠:";
    // Modify the response JSON to include all conversation data
    res.status(200).json({
        success: true,
        response: {
            assistant_message,
            conversation: {
                name: currentConversation.name,
                idUsuario: currentConversation.idUsuario,
                budget: currentConversation.budget,
                dateOfVisit: currentConversation.dateOfVisit,
                project: currentConversation.project,
                appointment: currentConversation.appointment,
                wantsAdvisor: currentConversation.wantsAdvisor,
                hasRecommendations: currentConversation.hasRecommendations,
                recommendedProjects: JSON.parse(currentConversation.availableProjects),
                shortcuts: generateShortcuts(JSON.parse(currentConversation.availableProjects)),
            }
        }
    });
});



// Start the server
app.listen(3000, '0.0.0.0', () => {
    console.log('Servidor corriendo en http://0.0.0.0:3000');
});