const cheerio = require('cheerio');

/**
 * Парсит расписание из HTML-страницы s.kubsau.ru
 * @param {string} html - HTML-код страницы
 * @param {string} groupName - Номер группы (например, "ПИ2403")
 * @returns {object} - Структурированное расписание
 */
function parseSchedule(html, groupName) {
    const $ = cheerio.load(html);

    // Определяем группу (берём из заголовка)
    const group = $('h2 strong').first().text().trim() || groupName;

    // Дата обновления
    let fetchedAt = '';
    const updateMatch = html.match(/Дата обновления:\s*([\d\-:\s]+)/);
    if (updateMatch) {
        fetchedAt = updateMatch[1].trim();
    } else {
        fetchedAt = new Date().toISOString();
    }

    const result = {
        group,
        fetched_at: fetchedAt,
        weeks: []
    };

    // Функция парсинга одного дня (блок .card-block)
    function parseDay(dayElement) {
        const $day = $(dayElement);
        
        // Дата из класса day-YYYY-MM-DD
        const classNames = $day.attr('class') || '';
        const dateMatch = classNames.match(/day-(\d{4}-\d{2}-\d{2})/);
        const date = dateMatch ? dateMatch[1] : '';

        // Заголовок дня (например, "Понедельник | 30 марта")
        const titleText = $day.find('.card-title').first().text().trim();
        let weekday = titleText.split('|')[0].trim();

        const pairs = [];
        const rows = $day.find('table.table tbody tr');

        rows.each((idx, row) => {
            const $row = $(row);
            const $timeCell = $row.find('td.time');
            const $lectionCell = $row.find('td.lection');   // тут тип занятия
            const $dissCell = $row.find('td.diss');
            const $whereCell = $row.find('td.who-where');

            // Есть ли предмет (не пустая ячейка diss)
            const hasSubject = $dissCell.text().trim().length > 0;
            if (!hasSubject) return; // пропускаем пустые строки

            // --- Время ---
            const timeHtml = $timeCell.html() || '';
            const times = timeHtml.split('<br>').map(t => t.trim());
            let startTime = '', endTime = '';
            if (times.length >= 2) {
                startTime = times[0];
                endTime = times[1];
            } else {
                const timeText = $timeCell.text().trim();
                const match = timeText.match(/(\d{2}:\d{2})\s+(\d{2}:\d{2})/);
                if (match) {
                    startTime = match[1];
                    endTime = match[2];
                }
            }

            // --- Тип занятия (лекция или семинар/практика) ---
            // В исходном HTML у лекций класс "lection", у семинаров – "lection yes"
            const lectionClasses = $lectionCell.attr('class') || '';
            const isSeminar = lectionClasses.includes('yes');
            const type = ! isSeminar ? 'seminar' : 'lecture';

            // --- Предмет и преподаватели ---
            // Копируем ячейку, удаляем вложенные .diss-info, чтобы получить чистое название предмета
            const $dissClone = $dissCell.clone();
            $dissClone.find('.diss-info').remove();
            let subject = $dissClone.text().trim().replace(/\s+/g, ' ');
            if (!subject) {
                // fallback: возможно предмет в <strong>
                subject = $dissCell.find('strong').first().text().trim();
            }
            if (!subject) {
                subject = $dissCell.text().trim().replace(/\s+/g, ' ');
            }

            // Преподаватели: собираем из всех .diss-info
            const teachers = [];
            $dissCell.find('.diss-info').each((i, el) => {
                let teacherText = $(el).text().trim().replace(/\s+/g, ' ');
                if (teacherText) {
                    // Внутри может быть несколько через запятую
                    const parts = teacherText.split(',').map(p => p.trim());
                    parts.forEach(p => {
                        if (p && !teachers.includes(p)) teachers.push(p);
                    });
                }
            });

            // --- Аудитории ---
            const rooms = [];
            $whereCell.find('a.room-link').each((i, el) => {
                const room = $(el).text().trim();
                if (room) rooms.push(room);
            });
            if (rooms.length === 0) {
                const roomText = $whereCell.text().trim();
                if (roomText) {
                    const splitRooms = roomText.split(/\s+/);
                    splitRooms.forEach(r => { if (r) rooms.push(r); });
                }
            }

            pairs.push({
                time_range: `${startTime} ${endTime}`,
                start_time: startTime,
                end_time: endTime,
                subject: subject || 'Без названия',
                teachers: teachers,
                rooms: rooms,
                has_lesson: true,
                type: type
            });
        });

        return {
            date,
            weekday,
            title: titleText,
            pairs
        };
    }

    // --- Парсинг первой и второй недель ---
    const $firstTab = $('#first');
    const $secondTab = $('#second');

    if ($firstTab.length) {
        const $firstWeek = $firstTab.find('.schedule-first-week');
        if ($firstWeek.length) {
            const days = [];
            $firstWeek.find('.card-block').each((i, el) => {
                const dayData = parseDay(el);
                if (dayData.pairs.length) days.push(dayData);
            });
            if (days.length) {
                result.weeks.push({
                    week_name: 'Первая неделя',
                    week_id: 'first',
                    days
                });
            }
        }
    }

    if ($secondTab.length) {
        const $secondWeek = $secondTab.find('.schedule-second-week');
        if ($secondWeek.length) {
            const days = [];
            $secondWeek.find('.card-block').each((i, el) => {
                const dayData = parseDay(el);
                if (dayData.pairs.length) days.push(dayData);
            });
            if (days.length) {
                result.weeks.push({
                    week_name: 'Вторая неделя',
                    week_id: 'second',
                    days
                });
            }
        }
    }

    // Fallback: если не нашли вкладки, пытаемся взять быстрый блок (первые три дня текущей недели)
    if (result.weeks.length === 0) {
        const $fastDays = $('.fast-schedule .card-block');
        if ($fastDays.length) {
            const days = [];
            $fastDays.each((i, el) => {
                const dayData = parseDay(el);
                if (dayData.pairs.length) days.push(dayData);
            });
            if (days.length) {
                result.weeks.push({
                    week_name: 'Текущая неделя',
                    week_id: 'current',
                    days
                });
            }
        }
    }

    return result;
}

module.exports = { parseSchedule };
