require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const NodeCache = require('node-cache');
const { parseSchedule } = require('./services/parser');

const app = express();
const PORT = process.env.PORT || 3010;

// Инициализация кэша (время жизни записи: 1 час = 3600 сек)
// Это снизит нагрузку на сайт университета при частых запросах одной группы
const cache = new NodeCache({ stdTTL: 3600, checkperiod: 600 });

// Middleware
app.use(cors()); // Разрешаем CORS для всех источников
app.use(express.json());

// Логгер запросов (опционально)
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

/**
 * Эндпоинт получения расписания
 * GET /schedule?group=ПИ2403
 */
app.get('/schedule', async (req, res) => {
    const group = req.query.group;

    // 1. Валидация входных данных
    if (!group) {
        return res.status(400).json({ error: 'Не указан параметр "group". Пример: ?group=ПИ2403' });
    }

    const normalizedGroup = group.toLowerCase().trim();
    const cacheKey = `schedule_${normalizedGroup}`;

    // 2. Проверка кэша
    const cachedData = cache.get(cacheKey);
    if (cachedData) {
        console.log(`Hit cache for group: ${normalizedGroup}`);
        return res.json(cachedData);
    }

    try {
        // 3. Формирование запроса к университету
        const targetUrl = `https://s.kubsau.ru/?type_schedule=1&val=${encodeURIComponent(normalizedGroup)}`;
        
        console.log(`Fetching from: ${targetUrl}`);

        // Делаем запрос, притворяясь обычным браузером (важно для обхода блокировок)
        const response = await axios.get(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7'
            },
            timeout: 10000 // Таймаут 10 секунд
        });

        // 4. Парсинг HTML
        const parsedData = parseSchedule(response.data, normalizedGroup);
        console.log('Parsed data:', parsedData);

        // Проверка: если расписание пустое, возможно группа неверна
        if (!parsedData.weeks || parsedData.weeks.length === 0) {
            return res.status(404).json({ 
                error: 'Расписание не найдено. Проверьте правильность номера группы.' 
            });
        }

        // 5. Сохранение в кэш и отправка ответа
        cache.set(cacheKey, parsedData);
        
        res.json(parsedData);

    } catch (error) {
        console.error('Error fetching schedule:', error.message);
        
        if (error.code === 'ECONNABORTED') {
            return res.status(504).json({ error: 'Таймаут подключения к серверу университета.' });
        }
        
        res.status(500).json({ 
            error: 'Ошибка при получении данных. Попробуйте позже.',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Health check эндпоинт
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
    console.log(`📝 Try: http://localhost:${PORT}/schedule?group=пи2403`);
});